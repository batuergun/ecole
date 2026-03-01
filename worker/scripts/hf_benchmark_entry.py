# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "torch",
#     "transformers",
#     "datasets",
#     "peft",
#     "huggingface_hub",
#     "accelerate",
# ]
# ///
"""Ecole HF Benchmark entry script — runs model inference on HF infrastructure.

This script is dispatched via `run_uv_job()` and runs self-contained on HF Jobs.
It loads eval questions, generates answers with the base model (and optionally
the fine-tuned adapter), then pushes all results back to HF Hub for the worker
to score locally.
"""

import os
import sys

import torch
from datasets import Dataset, load_dataset
from huggingface_hub import HfApi
from peft import PeftModel
from transformers import AutoConfig, AutoModelForCausalLM, AutoTokenizer


def _load_causal_model(model_name: str, dtype: torch.dtype, token: str):
    """Load a causal LM, handling multimodal models like Ministral 3 (Mistral3)."""
    config = AutoConfig.from_pretrained(model_name, token=token)
    if config.model_type == "mistral3":
        from transformers import Mistral3ForConditionalGeneration
        return Mistral3ForConditionalGeneration.from_pretrained(
            model_name, dtype=dtype, device_map="auto", token=token,
        )
    return AutoModelForCausalLM.from_pretrained(
        model_name, dtype=dtype, device_map="auto", token=token,
    )


def _prepare_inputs(tokenizer, questions: list[str]) -> list[str]:
    """Format questions as chat-templated strings."""
    formatted = []
    for question in questions:
        messages = [{"role": "user", "content": question}]
        try:
            text = tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True,
            )
        except Exception:
            text = f"Question: {question}\nAnswer:"
        formatted.append(text)
    return formatted


def _generate_batch(model, tokenizer, input_texts: list[str], max_new_tokens: int = 512) -> list[str]:
    """Generate answers for a batch of inputs."""
    inputs = tokenizer(
        input_texts, return_tensors="pt", padding=True, truncation=True,
    ).to(model.device)

    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=False,
            temperature=1.0,
            pad_token_id=tokenizer.pad_token_id,
        )

    answers = []
    for i, output in enumerate(outputs):
        generated = output[inputs["input_ids"][i].shape[0]:]
        answers.append(tokenizer.decode(generated, skip_special_tokens=True).strip())
    return answers


def _run_inference(model, tokenizer, eval_data, model_type: str, batch_size: int = 8) -> list[dict]:
    """Run batched inference on all eval questions and return results."""
    results = []
    total = len(eval_data)
    questions = [item["question"] for item in eval_data]
    input_texts = _prepare_inputs(tokenizer, questions)

    for start in range(0, total, batch_size):
        end = min(start + batch_size, total)
        batch_texts = input_texts[start:end]
        batch_answers = _generate_batch(model, tokenizer, batch_texts)

        for i, answer in enumerate(batch_answers):
            idx = start + i
            results.append({
                "question": eval_data[idx]["question"],
                "expected": eval_data[idx]["expected"],
                "answer": answer,
                "model_type": model_type,
            })

        print(f"[ecole-hf-bench] {model_type}: {end}/{total}")

    return results


def main():
    # Read config from environment
    eval_dataset_repo = os.environ.get("ECOLE_EVAL_DATASET_REPO")
    base_model = os.environ.get("ECOLE_BASE_MODEL", "mistralai/Ministral-3-3B-Reasoning-2512")
    adapter_repo = os.environ.get("ECOLE_ADAPTER_REPO", "")
    output_repo = os.environ.get("ECOLE_OUTPUT_REPO", "")
    hf_token = os.environ.get("HF_TOKEN", "")

    if not eval_dataset_repo:
        print("ERROR: ECOLE_EVAL_DATASET_REPO env var is required")
        sys.exit(1)

    if not output_repo:
        print("ERROR: ECOLE_OUTPUT_REPO env var is required")
        sys.exit(1)

    print(f"[ecole-hf-bench] Base model: {base_model}")
    print(f"[ecole-hf-bench] Eval dataset: {eval_dataset_repo}")
    print(f"[ecole-hf-bench] Adapter repo: {adapter_repo or '(none)'}")
    print(f"[ecole-hf-bench] Output repo: {output_repo}")

    # Load eval dataset from HF Hub
    eval_ds = load_dataset(eval_dataset_repo, split="train", token=hf_token)
    eval_data = [dict(row) for row in eval_ds]
    print(f"[ecole-hf-bench] Loaded {len(eval_data)} eval questions")

    # Load tokenizer
    print(f"[ecole-hf-bench] Loading tokenizer...")
    tokenizer = AutoTokenizer.from_pretrained(base_model, token=hf_token)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    # Load base model
    print(f"[ecole-hf-bench] Loading base model in bf16...")
    model = _load_causal_model(base_model, dtype=torch.bfloat16, token=hf_token)
    model.eval()

    # --- Base model inference ---
    print(f"[ecole-hf-bench] Running base model inference...")
    all_results = _run_inference(model, tokenizer, eval_data, model_type="base")

    # --- Finetuned model inference (if adapter provided) ---
    if adapter_repo:
        print(f"[ecole-hf-bench] Loading adapter from {adapter_repo}...")
        model = PeftModel.from_pretrained(model, adapter_repo, token=hf_token)
        model.eval()

        print(f"[ecole-hf-bench] Running finetuned model inference...")
        ft_results = _run_inference(model, tokenizer, eval_data, model_type="finetuned")
        all_results.extend(ft_results)

    # Cleanup GPU memory
    del model
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    # Push results to HF Hub
    print(f"[ecole-hf-bench] Pushing {len(all_results)} results to {output_repo}...")
    results_ds = Dataset.from_list(all_results)
    api = HfApi(token=hf_token)
    api.create_repo(output_repo, repo_type="dataset", exist_ok=True, private=True)
    results_ds.push_to_hub(output_repo, token=hf_token, private=True)

    print(f"[ecole-hf-bench] Done! Results at https://huggingface.co/datasets/{output_repo}")


if __name__ == "__main__":
    main()
