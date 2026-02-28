"""Push fine-tuned adapter to HuggingFace Hub."""

import json
import os

from huggingface_hub import HfApi

from worker.client import APIClient


def push_to_hub(adapter_path: str, repo_id: str, hf_token: str) -> str:
    """Upload adapter weights to HuggingFace Hub.

    Returns the repo URL.
    """
    api = HfApi(token=hf_token)
    api.create_repo(repo_id, exist_ok=True, private=True)
    api.upload_folder(
        folder_path=adapter_path,
        repo_id=repo_id,
        commit_message="Fine-tuned adapter uploaded by Ecole",
    )
    return f"https://huggingface.co/{repo_id}"


def run(client: APIClient, job: dict) -> None:
    """Execute the HF upload job."""
    payload = job.get("payload", {})
    if isinstance(payload, str):
        payload = json.loads(payload)
    project_id = payload.get("project_id", job.get("project_id"))
    training_run_id = payload["training_run_id"]

    print(f"[hf_upload] Starting for run {training_run_id}")

    # Get training run info
    run_info = client.get_training_run(training_run_id)
    adapter_path = run_info.get("output_model_path")

    if not adapter_path or not os.path.exists(adapter_path):
        raise ValueError(f"Adapter not found at {adapter_path}")

    # Get HF token
    keys = client.get_api_keys(project_id)
    hf_token = keys.get("hf_token") or os.getenv("HF_TOKEN", "")
    if not hf_token:
        raise ValueError("No HuggingFace token configured. Set it in Settings or HF_TOKEN env var.")

    # Build repo ID: user/ecole-{project_name}-{model_short}
    project = client.get_project(project_id)
    project_name = project.get("name", "model").lower().replace(" ", "-")
    model_short = run_info["base_model"].split("/")[-1].lower()
    repo_id = f"ecole-{project_name}-{model_short}"

    # Get HF username
    hf_api = HfApi(token=hf_token)
    user_info = hf_api.whoami()
    username = user_info.get("name", user_info.get("user", "user"))
    full_repo_id = f"{username}/{repo_id}"

    print(f"[hf_upload] Pushing to {full_repo_id}")

    url = push_to_hub(adapter_path, full_repo_id, hf_token)

    # Update training run with repo ID
    client.set_training_hf_repo(training_run_id, full_repo_id)

    print(f"[hf_upload] Done: {url}")
