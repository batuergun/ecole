"""Fine-tune a model using TRL SFTTrainer with LoRA."""

import json
import os
import re
import time

from worker.client import APIClient


OUTPUT_DIR = os.environ.get("ECOLE_MODEL_DIR", "/tmp/ecole_models")
HF_JOB_ENTRY_SCRIPT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
    "scripts",
    "hf_job_entry.py",
)

# Default GPU flavor mapping (used as fallback when no flavor is specified)
DEFAULT_HF_FLAVORS = {
    "mistralai/Ministral-3-3B-Reasoning-2512": "a10g-small",
    "mistralai/Ministral-3-8B-Reasoning-2512": "a10g-large",
}


def _parse_hf_metrics(log_text: str) -> dict:
    """Parse training metrics from HF Jobs log output.

    Looks for the last metrics dict (e.g. {'loss': 0.5, 'grad_norm': 1.2, ...})
    and step progress lines (e.g. '5/12 [00:30<01:00, ...]').
    """
    result: dict = {}

    # Find last metrics dict: {'loss': ..., 'grad_norm': ..., 'learning_rate': ..., 'epoch': ...}
    metrics_pattern = re.compile(r"\{['\"]loss['\"]:\s*[\d.]+.*?\}")
    matches = metrics_pattern.findall(log_text)
    if matches:
        last_match = matches[-1]
        # Convert single-quoted Python dict to valid JSON
        try:
            json_str = last_match.replace("'", '"')
            metrics = json.loads(json_str)
            if "loss" in metrics:
                result["loss"] = float(metrics["loss"])
            if "grad_norm" in metrics:
                result["grad_norm"] = float(metrics["grad_norm"])
            if "learning_rate" in metrics:
                result["learning_rate"] = float(metrics["learning_rate"])
            if "epoch" in metrics:
                result["epoch"] = float(metrics["epoch"])
        except (json.JSONDecodeError, ValueError):
            pass

    # Find step progress: N/M or N / M within progress bar lines
    step_pattern = re.compile(r"(\d+)/(\d+)\s*\[")
    step_matches = step_pattern.findall(log_text)
    if step_matches:
        last_step = step_matches[-1]
        try:
            result["current_step"] = int(last_step[0])
            result["total_steps"] = int(last_step[1])
        except ValueError:
            pass

    return result


def run(client: APIClient, job: dict) -> None:
    """Execute the training pipeline."""
    payload = job.get("payload", {})
    if isinstance(payload, str):
        payload = json.loads(payload)
    project_id = payload.get("project_id", job.get("project_id"))
    training_run_id = payload["training_run_id"]

    print(f"[training] Starting for project {project_id}, run {training_run_id}")

    # Fetch training run config
    run_info = client.get_training_run(training_run_id)
    compute_mode = run_info.get("compute_mode", "local")

    if compute_mode == "hf_jobs":
        _run_hf_jobs(client, job, project_id, training_run_id, run_info)
    else:
        _run_local(client, job, project_id, training_run_id, run_info)


def _run_hf_jobs(
    client: APIClient,
    job: dict,
    project_id: str,
    training_run_id: str,
    run_info: dict,
) -> None:
    """Dispatch training to HF Jobs infrastructure."""
    from huggingface_hub import run_uv_job, inspect_job, fetch_job_logs

    base_model = run_info["base_model"]
    lora_config_raw = run_info.get("lora_config", {})
    training_config_raw = run_info.get("training_config", {})

    if isinstance(lora_config_raw, str):
        lora_config_raw = json.loads(lora_config_raw)
    if isinstance(training_config_raw, str):
        training_config_raw = json.loads(training_config_raw)

    # Get API keys
    keys = client.get_api_keys(project_id)
    hf_token = keys.get("hf_token") or os.getenv("HF_TOKEN", "")
    if not hf_token:
        raise ValueError("HuggingFace token required for HF Jobs compute mode.")

    # Fetch dataset
    client.update_training_progress(training_run_id, epoch=0)
    dataset_items = client.get_dataset(project_id, eval_only=False)
    train_items = [
        {"question": item["question"], "answer": item["answer"]}
        for item in dataset_items
        if not item.get("is_eval", False)
    ]

    if not train_items:
        raise ValueError("No training data available.")

    print(f"[training:hf_jobs] {len(train_items)} training examples")

    # Build output repo name
    project = client.get_project(project_id)
    project_name = project.get("name", "model").lower().replace(" ", "-")
    model_short = base_model.split("/")[-1].lower()

    hf_namespace = run_info.get("hf_namespace")

    from huggingface_hub import HfApi
    hf_api = HfApi(token=hf_token)

    if hf_namespace:
        owner = hf_namespace
    else:
        user_info = hf_api.whoami()
        owner = user_info.get("name", user_info.get("user", "user"))

    output_repo = f"{owner}/ecole-{project_name}-{model_short}"

    # Push dataset to HF Hub as a proper dataset repo
    from datasets import Dataset

    formatted = _format_dataset(train_items)
    dataset = Dataset.from_list(formatted)
    dataset_repo = f"{owner}/ecole-{project_name}-dataset-{training_run_id[:8]}"
    hf_api.create_repo(dataset_repo, repo_type="dataset", exist_ok=True, private=True)
    dataset.push_to_hub(dataset_repo, token=hf_token, private=True)
    print(f"[training:hf_jobs] Dataset pushed to {dataset_repo}")

    # Select GPU flavor — use explicit choice from run_info, fall back to model default
    flavor = run_info.get("hf_flavor") or DEFAULT_HF_FLAVORS.get(base_model, "a10g-small")

    # Estimate timeout based on dataset size and epochs
    num_epochs = training_config_raw.get("num_train_epochs", 3)
    estimated_minutes = max(30, len(train_items) * num_epochs // 10)
    timeout = f"{min(estimated_minutes, 360)}m"

    print(f"[training:hf_jobs] Dispatching to HF Jobs: flavor={flavor}, timeout={timeout}")

    # Dispatch the job
    job_kwargs = dict(
        flavor=flavor,
        timeout=timeout,
        env={
            "ECOLE_DATASET_REPO": dataset_repo,
            "ECOLE_BASE_MODEL": base_model,
            "ECOLE_LORA_CONFIG": json.dumps(lora_config_raw),
            "ECOLE_TRAINING_CONFIG": json.dumps(training_config_raw),
            "ECOLE_OUTPUT_REPO": output_repo,
        },
        secrets={"HF_TOKEN": hf_token},
        token=hf_token,
    )
    if hf_namespace:
        job_kwargs["namespace"] = hf_namespace

    hf_job = run_uv_job(HF_JOB_ENTRY_SCRIPT, **job_kwargs)

    hf_job_id = hf_job.id
    hf_job_url = getattr(hf_job, "url", None) or f"https://huggingface.co/jobs/{hf_job_id}"
    print(f"[training:hf_jobs] Dispatched HF Job: {hf_job_id} — {hf_job_url}")

    # Save HF job URL so the frontend can link to it
    client.set_hf_job_id(training_run_id, hf_job_url)

    # Update training run status
    client.update_training_progress(training_run_id, epoch=0)

    # Poll for completion
    poll_interval = 30  # seconds
    max_poll_failures = 5  # consecutive failures before giving up
    consecutive_failures = 0
    accumulated_logs = ""

    while True:
        time.sleep(poll_interval)

        try:
            job_info = inspect_job(job_id=hf_job_id, token=hf_token)
            consecutive_failures = 0
        except Exception as e:
            consecutive_failures += 1
            print(f"[training:hf_jobs] Failed to inspect job {hf_job_id} ({consecutive_failures}/{max_poll_failures}): {e}")
            if consecutive_failures >= max_poll_failures:
                error_msg = f"Lost contact with HF Job {hf_job_id} after {max_poll_failures} poll failures: {e}"
                client.fail_training_run(training_run_id, error_msg)
                raise RuntimeError(error_msg)
            continue

        stage = job_info.status.stage

        print(f"[training:hf_jobs] Job {hf_job_id} status: {stage}")

        # Fetch logs for running/completed/error stages
        if stage in ("RUNNING", "COMPLETED", "ERROR"):
            try:
                log_text = fetch_job_logs(job_id=hf_job_id, token=hf_token)
                if log_text:
                    accumulated_logs = log_text
                    client.update_training_logs(training_run_id, accumulated_logs)
            except Exception as e:
                print(f"[training:hf_jobs] Failed to fetch logs: {e}")

        if stage == "COMPLETED":
            # Final log + metrics parse
            metrics = _parse_hf_metrics(accumulated_logs)
            client.update_training_progress(
                training_run_id,
                epoch=int(metrics.get("epoch", 0)),
                loss=metrics.get("loss"),
                current_step=metrics.get("current_step", 0),
                total_steps=metrics.get("total_steps"),
                grad_norm=metrics.get("grad_norm"),
                learning_rate=metrics.get("learning_rate"),
            )
            # Job finished — adapter should be on HF Hub
            client.set_training_hf_repo(training_run_id, output_repo)
            client.complete_training_run(training_run_id, f"hf://{output_repo}")
            client.update_project_status(project_id, "trained")
            print(f"[training:hf_jobs] Done: adapter at {output_repo}")
            return

        elif stage == "ERROR":
            error_msg = job_info.status.message or "HF Job failed"
            client.fail_training_run(training_run_id, error_msg)
            raise RuntimeError(f"HF Job failed: {error_msg}")

        elif stage in ("RUNNING", "STARTING"):
            # Parse metrics from logs and report progress
            metrics = _parse_hf_metrics(accumulated_logs)
            client.update_training_progress(
                training_run_id,
                epoch=int(metrics.get("epoch", 0)),
                loss=metrics.get("loss"),
                current_step=metrics.get("current_step", 0),
                total_steps=metrics.get("total_steps"),
                grad_norm=metrics.get("grad_norm"),
                learning_rate=metrics.get("learning_rate"),
            )

        # If job is in any other state (QUEUED, etc.), just keep polling


def _run_local(
    client: APIClient,
    job: dict,
    project_id: str,
    training_run_id: str,
    run_info: dict,
) -> None:
    """Run training locally with GPU."""
    import torch
    from datasets import Dataset
    from peft import LoraConfig, TaskType
    from transformers import AutoConfig, AutoModelForCausalLM, AutoTokenizer, TrainerCallback
    from trl import SFTConfig, SFTTrainer

    base_model = run_info["base_model"]
    lora_config_raw = run_info.get("lora_config", {})
    training_config_raw = run_info.get("training_config", {})

    if isinstance(lora_config_raw, str):
        lora_config_raw = json.loads(lora_config_raw)
    if isinstance(training_config_raw, str):
        training_config_raw = json.loads(training_config_raw)

    # Fetch dataset (non-eval items only)
    client.update_training_progress(training_run_id, epoch=0)

    dataset_items = client.get_dataset(project_id, eval_only=False)
    train_items = [item for item in dataset_items if not item.get("is_eval", False)]

    if not train_items:
        raise ValueError("No training data available. Generate a dataset first.")

    print(f"[training:local] {len(train_items)} training examples")

    # Format as chat messages
    formatted = _format_dataset(train_items)
    dataset = Dataset.from_list(formatted)

    # Training params
    num_epochs = training_config_raw.get("num_train_epochs", 3)
    batch_size = training_config_raw.get("per_device_train_batch_size", 4)
    lr = training_config_raw.get("learning_rate", 1e-4)
    warmup_ratio = training_config_raw.get("warmup_ratio", 0.1)
    max_seq_length = training_config_raw.get("max_seq_length", 2048)
    grad_accum = training_config_raw.get("gradient_accumulation_steps", 4)
    logging_steps = training_config_raw.get("logging_steps", 10)
    use_bf16 = training_config_raw.get("bf16", True)

    # LoRA params
    lora_r = lora_config_raw.get("r", 16)
    lora_alpha = lora_config_raw.get("lora_alpha", 32)
    lora_dropout = lora_config_raw.get("lora_dropout", 0.05)
    target_modules = lora_config_raw.get(
        "target_modules", ["q_proj", "k_proj", "v_proj", "o_proj"]
    )

    # Output path
    output_path = os.path.join(OUTPUT_DIR, project_id, training_run_id)
    os.makedirs(output_path, exist_ok=True)

    print(f"[training:local] Loading model: {base_model}")

    # Load tokenizer
    tokenizer = AutoTokenizer.from_pretrained(base_model)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    # Load model in bf16 (handle multimodal models like Ministral 3)
    model_dtype = torch.bfloat16 if use_bf16 else torch.float32
    config = AutoConfig.from_pretrained(base_model)
    if config.model_type == "mistral3":
        from transformers import Mistral3ForConditionalGeneration
        model = Mistral3ForConditionalGeneration.from_pretrained(
            base_model, dtype=model_dtype, device_map="auto",
        )
    else:
        model = AutoModelForCausalLM.from_pretrained(
            base_model, dtype=model_dtype, device_map="auto",
        )

    # LoRA config
    peft_config = LoraConfig(
        task_type=TaskType.CAUSAL_LM,
        r=lora_r,
        lora_alpha=lora_alpha,
        lora_dropout=lora_dropout,
        target_modules=target_modules,
    )

    # SFT config
    sft_config = SFTConfig(
        output_dir=output_path,
        num_train_epochs=num_epochs,
        per_device_train_batch_size=batch_size,
        learning_rate=lr,
        warmup_ratio=warmup_ratio,
        max_length=max_seq_length,
        gradient_accumulation_steps=grad_accum,
        logging_steps=logging_steps,
        bf16=use_bf16,
        save_strategy="epoch",
        save_total_limit=num_epochs,
        report_to="none",
        remove_unused_columns=False,
    )

    # Progress callback
    log_lines: list[str] = []

    class ProgressCallback(TrainerCallback):
        def on_log(self, args, state, control, logs=None, **kwargs):
            if logs and "loss" in logs:
                epoch = int(state.epoch) if state.epoch else 0
                loss = logs.get("loss")
                grad_norm = logs.get("grad_norm")
                lr = logs.get("learning_rate")
                current_step = state.global_step
                total_steps = state.max_steps

                # Capture log line
                log_entry = f"Step {current_step}/{total_steps} | loss={loss}"
                if grad_norm is not None:
                    log_entry += f" grad_norm={grad_norm:.4f}"
                if lr is not None:
                    log_entry += f" lr={lr:.2e}"
                log_lines.append(log_entry)

                client.update_training_progress(
                    training_run_id,
                    epoch=epoch,
                    loss=loss,
                    current_step=current_step,
                    total_steps=total_steps,
                    grad_norm=grad_norm,
                    learning_rate=lr,
                )

                # Send logs every 5 log events
                if len(log_lines) % 5 == 0:
                    client.update_training_logs(training_run_id, "\n".join(log_lines))

        def on_epoch_end(self, args, state, control, **kwargs):
            epoch = int(state.epoch) if state.epoch else 0
            client.update_training_progress(
                training_run_id,
                epoch=epoch,
                current_step=state.global_step,
                total_steps=state.max_steps,
            )

        def on_train_end(self, args, state, control, **kwargs):
            if log_lines:
                client.update_training_logs(training_run_id, "\n".join(log_lines))

    print(f"[training:local] Starting SFTTrainer: {num_epochs} epochs, batch={batch_size}, lr={lr}")

    trainer = SFTTrainer(
        model=model,
        args=sft_config,
        train_dataset=dataset,
        processing_class=tokenizer,
        peft_config=peft_config,
        callbacks=[ProgressCallback()],
    )

    # Train
    trainer.train()

    # Save adapter
    adapter_path = os.path.join(output_path, "adapter")
    trainer.save_model(adapter_path)
    tokenizer.save_pretrained(adapter_path)

    print(f"[training:local] Adapter saved to {adapter_path}")

    # Report completion
    client.complete_training_run(training_run_id, adapter_path)
    client.update_project_status(project_id, "trained")

    print(f"[training:local] Done: {training_run_id}")


def _format_dataset(items: list[dict]) -> list[dict]:
    """Format Q&A items as chat messages for SFTTrainer."""
    formatted = []
    for item in items:
        messages = [
            {"role": "user", "content": item["question"]},
            {"role": "assistant", "content": item["answer"]},
        ]
        formatted.append({"messages": messages})
    return formatted
