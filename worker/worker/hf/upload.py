"""Push fine-tuned adapter to HuggingFace Hub."""


def push_to_hub(adapter_path: str, repo_id: str, hf_token: str) -> str:
    """Upload adapter weights to HuggingFace Hub.

    Returns the repo URL.
    """
    # TODO: Phase 3 implementation
    # from huggingface_hub import HfApi
    # api = HfApi(token=hf_token)
    # api.create_repo(repo_id, exist_ok=True, private=True)
    # api.upload_folder(folder_path=adapter_path, repo_id=repo_id, commit_message="Uploaded by Ecole")
    # return f"https://huggingface.co/{repo_id}"
    return ""
