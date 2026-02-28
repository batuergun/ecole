from worker.client import APIClient


def run(client: APIClient, job: dict) -> None:
    """Auto-harness: extract data from uploads and generate Q&A pairs using Claude."""
    # TODO: Phase 2 implementation
    # 1. Fetch uploads for the project
    # 2. Extract text/images from PDFs using PyMuPDF
    # 3. Split into chunks
    # 4. For each chunk, call Claude Sonnet to generate Q&A pairs
    # 5. Store dataset items via API
    print(f"Harness job stub - project: {job['project_id']}")
