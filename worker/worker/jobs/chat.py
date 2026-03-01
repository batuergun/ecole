"""Chat session: load model+adapter and serve interactive chat via polling."""

import json
import os
import time
import threading

from worker.client import APIClient
from worker.jobs.metrics import strip_think_tags


OUTPUT_DIR = os.environ.get("ECOLE_MODEL_DIR", "/tmp/ecole_models")
IDLE_TIMEOUT = 300  # 5 minutes


def run(client: APIClient, job: dict) -> None:
    """Execute the chat session job."""
    payload = job.get("payload", {})
    if isinstance(payload, str):
        payload = json.loads(payload)

    session_id = payload["session_id"]
    training_run_id = payload["training_run_id"]

    print(f"[chat] Starting session {session_id} for run {training_run_id}")

    # Get training run info
    run_info = client.get_training_run(training_run_id)
    base_model = run_info["base_model"]
    adapter_path = run_info.get("output_model_path")

    # Update session status to loading
    client.update_chat_session_status(session_id, "loading")

    try:
        model, tokenizer = _load_model(base_model, adapter_path)
    except Exception as e:
        print(f"[chat] Failed to load model: {e}")
        client.update_chat_session_status(session_id, "error")
        raise

    # Model loaded — session is ready
    client.update_chat_session_status(session_id, "ready")
    print(f"[chat] Session {session_id} ready")

    # Enter message loop
    last_activity = time.time()
    try:
        while True:
            # Check for pending message
            pending = client.get_pending_chat_message(session_id)

            if pending is None:
                # No pending message — check idle timeout
                if time.time() - last_activity > IDLE_TIMEOUT:
                    print(f"[chat] Session {session_id} idle timeout, closing")
                    break
                time.sleep(0.5)
                continue

            last_activity = time.time()
            message_id = pending["id"]
            print(f"[chat] Processing message {message_id}")

            try:
                _generate_response(client, model, tokenizer, session_id, message_id)
            except Exception as e:
                print(f"[chat] Generation error: {e}")
                client.update_chat_message(message_id, f"Error: {e}", "error")
    finally:
        # Cleanup
        _cleanup_model(model)
        client.update_chat_session_status(session_id, "closed")
        print(f"[chat] Session {session_id} closed")


def _load_model(base_model: str, adapter_path: str | None):
    """Load base model + optional LoRA adapter."""
    import torch
    from transformers import AutoConfig, AutoModelForCausalLM, AutoTokenizer

    print(f"[chat] Loading model: {base_model}")
    tokenizer = AutoTokenizer.from_pretrained(base_model)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    config = AutoConfig.from_pretrained(base_model)
    if config.model_type == "mistral3":
        from transformers import Mistral3ForConditionalGeneration
        model = Mistral3ForConditionalGeneration.from_pretrained(
            base_model, dtype=torch.bfloat16, device_map="auto",
        )
    else:
        model = AutoModelForCausalLM.from_pretrained(
            base_model, dtype=torch.bfloat16, device_map="auto",
        )

    if adapter_path:
        from peft import PeftModel
        print(f"[chat] Loading adapter: {adapter_path}")
        model = PeftModel.from_pretrained(model, adapter_path)

    model.eval()
    print(f"[chat] Model loaded successfully")
    return model, tokenizer


def _cleanup_model(model):
    """Unload model and free GPU memory."""
    import torch
    del model
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    print("[chat] Model unloaded, GPU memory freed")


def _generate_response(
    client: APIClient,
    model,
    tokenizer,
    session_id: str,
    message_id: str,
) -> None:
    """Generate a streaming response for a pending message."""
    import torch
    from transformers import TextIteratorStreamer

    # Get full message history for context
    messages = client.list_chat_messages(session_id)
    chat_history = []
    for m in messages:
        if m["status"] == "done":
            chat_history.append({"role": m["role"], "content": m["content"]})

    # Build input using chat template
    try:
        input_text = tokenizer.apply_chat_template(
            chat_history, tokenize=False, add_generation_prompt=True
        )
    except Exception:
        # Fallback: just use the last user message
        last_user = ""
        for m in reversed(messages):
            if m["role"] == "user" and m["status"] == "done":
                last_user = m["content"]
                break
        input_text = f"Question: {last_user}\nAnswer:"

    inputs = tokenizer(input_text, return_tensors="pt").to(model.device)

    # Set up streaming
    streamer = TextIteratorStreamer(tokenizer, skip_prompt=True, skip_special_tokens=True)
    generation_kwargs = {
        **inputs,
        "max_new_tokens": 1024,
        "do_sample": True,
        "temperature": 0.7,
        "top_p": 0.9,
        "pad_token_id": tokenizer.pad_token_id,
        "streamer": streamer,
    }

    # Run generation in background thread
    thread = threading.Thread(target=model.generate, kwargs=generation_kwargs)
    thread.start()

    # Stream tokens
    accumulated = ""
    token_count = 0

    client.update_chat_message(message_id, "", "streaming")

    for text in streamer:
        accumulated += text
        token_count += 1

        # Update DB every ~10 tokens (strip think tags from user-facing output)
        if token_count % 10 == 0:
            client.update_chat_message(message_id, strip_think_tags(accumulated), "streaming")

    thread.join()

    # Final update (strip think tags from user-facing output)
    client.update_chat_message(message_id, strip_think_tags(accumulated), "done")
    print(f"[chat] Generated {token_count} tokens for message {message_id}")
