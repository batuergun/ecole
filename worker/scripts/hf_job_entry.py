# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "torch",
#     "transformers",
#     "datasets",
#     "peft",
#     "trl",
#     "huggingface_hub",
#     "accelerate",
#     "trackio",
# ]
# ///
"""Ecole HF Job entry script — runs SFTTrainer + LoRA on HF infrastructure.

This script is dispatched via `run_uv_job()` and runs self-contained on HF Jobs.
It receives all config via environment variables, trains the model, and pushes
the adapter directly to HuggingFace Hub.
"""

import json
import os
import sys

import torch
from datasets import load_dataset
from huggingface_hub import HfApi
from peft import LoraConfig, TaskType
from transformers import AutoConfig, AutoModelForCausalLM, AutoTokenizer
from trl import SFTConfig, SFTTrainer


def _load_causal_model(model_name: str, dtype: torch.dtype, token: str):
    """Load a causal LM, handling multimodal models like Ministral 3 (Mistral3)."""
    config = AutoConfig.from_pretrained(model_name, token=token)
    if config.model_type == "mistral3":
        # Ministral 3 models use Mistral3Config (multimodal), which AutoModelForCausalLM
        # doesn't support. Load the full model with Mistral3ForConditionalGeneration instead.
        from transformers import Mistral3ForConditionalGeneration
        return Mistral3ForConditionalGeneration.from_pretrained(
            model_name, dtype=dtype, device_map="auto", token=token,
        )
    return AutoModelForCausalLM.from_pretrained(
        model_name, dtype=dtype, device_map="auto", token=token,
    )


def main():
    # Read config from environment
    dataset_repo = os.environ.get("ECOLE_DATASET_REPO")
    base_model = os.environ.get("ECOLE_BASE_MODEL", "mistralai/Ministral-3-3B-Reasoning-2512")
    lora_config_json = os.environ.get("ECOLE_LORA_CONFIG", "{}")
    training_config_json = os.environ.get("ECOLE_TRAINING_CONFIG", "{}")
    output_repo = os.environ.get("ECOLE_OUTPUT_REPO", "")
    hf_token = os.environ.get("HF_TOKEN", "")

    if not dataset_repo:
        print("ERROR: ECOLE_DATASET_REPO env var is required")
        sys.exit(1)

    # Parse configs
    lora_cfg = json.loads(lora_config_json)
    training_cfg = json.loads(training_config_json)

    print(f"[ecole-hf-job] Base model: {base_model}")
    print(f"[ecole-hf-job] Loading dataset from {dataset_repo}")
    print(f"[ecole-hf-job] Output repo: {output_repo}")

    # Load dataset from HF Hub (already formatted as chat messages)
    dataset = load_dataset(dataset_repo, split="train", token=hf_token)
    print(f"[ecole-hf-job] Training examples: {len(dataset)}")

    # Training params
    num_epochs = training_cfg.get("num_train_epochs", 3)
    batch_size = training_cfg.get("per_device_train_batch_size", 4)
    lr = training_cfg.get("learning_rate", 1e-4)
    warmup_ratio = training_cfg.get("warmup_ratio", 0.1)
    max_seq_length = training_cfg.get("max_seq_length", 2048)
    grad_accum = training_cfg.get("gradient_accumulation_steps", 4)
    logging_steps = training_cfg.get("logging_steps", 10)
    use_bf16 = training_cfg.get("bf16", True)

    # LoRA params
    lora_r = lora_cfg.get("r", 16)
    lora_alpha = lora_cfg.get("lora_alpha", 32)
    lora_dropout = lora_cfg.get("lora_dropout", 0.05)
    target_modules = lora_cfg.get("target_modules", ["q_proj", "k_proj", "v_proj", "o_proj"])

    output_dir = "/tmp/ecole_training"
    os.makedirs(output_dir, exist_ok=True)

    # Load tokenizer
    print(f"[ecole-hf-job] Loading tokenizer...")
    tokenizer = AutoTokenizer.from_pretrained(base_model, token=hf_token)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    # Load model
    print(f"[ecole-hf-job] Loading model in bf16...")
    model = _load_causal_model(
        base_model,
        dtype=torch.bfloat16 if use_bf16 else torch.float32,
        token=hf_token,
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
        output_dir=output_dir,
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
        report_to="trackio",
        run_name=os.environ.get("ECOLE_RUN_NAME", "ecole-training"),
        remove_unused_columns=False,
    )

    # Train
    print(f"[ecole-hf-job] Starting training: {num_epochs} epochs, batch={batch_size}, lr={lr}")
    trainer = SFTTrainer(
        model=model,
        args=sft_config,
        train_dataset=dataset,
        processing_class=tokenizer,
        peft_config=peft_config,
    )
    trainer.train()

    # Save adapter
    adapter_path = os.path.join(output_dir, "adapter")
    trainer.save_model(adapter_path)
    tokenizer.save_pretrained(adapter_path)
    print(f"[ecole-hf-job] Adapter saved to {adapter_path}")

    # Push to HF Hub
    if output_repo and hf_token:
        print(f"[ecole-hf-job] Pushing adapter to {output_repo}...")
        api = HfApi(token=hf_token)
        api.create_repo(output_repo, exist_ok=True, private=True)
        api.upload_folder(
            folder_path=adapter_path,
            repo_id=output_repo,
            commit_message="Fine-tuned adapter uploaded by Ecole (HF Jobs)",
        )
        print(f"[ecole-hf-job] Pushed to https://huggingface.co/{output_repo}")
    else:
        print("[ecole-hf-job] Skipping HF push (no output_repo or hf_token)")

    print("[ecole-hf-job] Done!")


if __name__ == "__main__":
    main()
