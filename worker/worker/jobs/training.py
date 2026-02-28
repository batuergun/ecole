from worker.client import APIClient


def run(client: APIClient, job: dict) -> None:
    """Fine-tune using TRL SFTTrainer with LoRA."""
    # TODO: Phase 3 implementation
    # 1. Fetch dataset from API
    # 2. Format as conversational messages
    # 3. Load base model in bf16
    # 4. Apply LoRA config
    # 5. Train with SFTTrainer, report progress
    # 6. Save adapter weights
    print(f"Training job stub - project: {job['project_id']}")
