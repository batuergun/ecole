from worker.client import APIClient


def run(client: APIClient, job: dict) -> None:
    """Auto-benchmark: evaluate base and fine-tuned models using LLM-as-judge."""
    # TODO: Phase 3 implementation
    # 1. Fetch eval dataset items
    # 2. Load model (base or fine-tuned)
    # 3. Generate answers for each eval question
    # 4. Use Claude as judge to score answers
    # 5. Store benchmark results
    print(f"Benchmark job stub - project: {job['project_id']}")
