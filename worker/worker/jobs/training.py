"""Fine-tune a model using TRL SFTTrainer with LoRA."""

import json
import os

import torch
from datasets import Dataset
from peft import LoraConfig, TaskType
from transformers import AutoModelForCausalLM, AutoTokenizer, TrainerCallback
from trl import SFTConfig, SFTTrainer

from worker.client import APIClient


OUTPUT_DIR = os.environ.get("ECOLE_MODEL_DIR", "/tmp/ecole_models")


class ProgressCallback(TrainerCallback):
    """Report training progress back to the API."""

    def __init__(self, client: APIClient, training_run_id: str, total_epochs: int):
        self.client = client
        self.training_run_id = training_run_id
        self.total_epochs = total_epochs

    def on_log(self, args, state, control, logs=None, **kwargs):
        if logs and "loss" in logs:
            epoch = int(state.epoch) if state.epoch else 0
            loss = logs.get("loss")
            self.client.update_training_progress(
                self.training_run_id, epoch=epoch, loss=loss
            )

    def on_epoch_end(self, args, state, control, **kwargs):
        epoch = int(state.epoch) if state.epoch else 0
        self.client.update_training_progress(
            self.training_run_id, epoch=epoch
        )


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

    print(f"[training] {len(train_items)} training examples")

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

    print(f"[training] Loading model: {base_model}")

    # Load tokenizer
    tokenizer = AutoTokenizer.from_pretrained(base_model)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    # Load model in bf16
    model = AutoModelForCausalLM.from_pretrained(
        base_model,
        torch_dtype=torch.bfloat16 if use_bf16 else torch.float32,
        device_map="auto",
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
        max_seq_length=max_seq_length,
        gradient_accumulation_steps=grad_accum,
        logging_steps=logging_steps,
        bf16=use_bf16,
        save_strategy="epoch",
        save_total_limit=2,
        report_to="none",
        remove_unused_columns=False,
    )

    # Progress callback
    progress_cb = ProgressCallback(client, training_run_id, num_epochs)

    print(f"[training] Starting SFTTrainer: {num_epochs} epochs, batch={batch_size}, lr={lr}")

    trainer = SFTTrainer(
        model=model,
        args=sft_config,
        train_dataset=dataset,
        processing_class=tokenizer,
        peft_config=peft_config,
        callbacks=[progress_cb],
    )

    # Train
    trainer.train()

    # Save adapter
    adapter_path = os.path.join(output_path, "adapter")
    trainer.save_model(adapter_path)
    tokenizer.save_pretrained(adapter_path)

    print(f"[training] Adapter saved to {adapter_path}")

    # Report completion
    client.complete_training_run(training_run_id, adapter_path)
    client.update_project_status(project_id, "trained")

    print(f"[training] Done: {training_run_id}")


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
