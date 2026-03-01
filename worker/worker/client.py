import httpx
from pathlib import Path
from typing import Any


class APIClient:
    def __init__(self, api_url: str, worker_id: str):
        self.api_url = api_url.rstrip("/")
        self.worker_id = worker_id
        self.http = httpx.Client(timeout=60)

    # --- Job lifecycle ---

    def poll_job(self) -> dict | None:
        resp = self.http.get(
            f"{self.api_url}/api/worker/poll",
            params={"worker_id": self.worker_id},
        )
        if resp.status_code == 204:
            return None
        resp.raise_for_status()
        return resp.json()

    def report_progress(self, job_id: str, data: dict[str, Any]) -> None:
        self.http.post(
            f"{self.api_url}/api/worker/jobs/{job_id}/progress",
            json={"status": "running", "data": data},
        )

    def complete_job(self, job_id: str) -> None:
        self.http.post(f"{self.api_url}/api/worker/jobs/{job_id}/complete")

    def fail_job(self, job_id: str, error: str) -> None:
        self.http.post(
            f"{self.api_url}/api/worker/jobs/{job_id}/fail",
            json={"error": error},
        )

    # --- Project data ---

    def get_project(self, project_id: str) -> dict:
        resp = self.http.get(f"{self.api_url}/api/worker/projects/{project_id}")
        resp.raise_for_status()
        return resp.json()

    def get_uploads(self, project_id: str) -> list[dict]:
        resp = self.http.get(f"{self.api_url}/api/worker/projects/{project_id}/uploads")
        resp.raise_for_status()
        return resp.json()

    def get_api_keys(self, project_id: str) -> dict:
        resp = self.http.get(f"{self.api_url}/api/worker/projects/{project_id}/keys")
        resp.raise_for_status()
        return resp.json()

    def update_project_status(self, project_id: str, status: str) -> None:
        self.http.patch(
            f"{self.api_url}/api/worker/projects/{project_id}/status",
            json={"status": status},
        )

    # --- File download ---

    def download_file(self, storage_key: str, dest_path: str) -> str:
        resp = self.http.get(
            f"{self.api_url}/api/worker/files",
            params={"key": storage_key},
        )
        resp.raise_for_status()
        Path(dest_path).parent.mkdir(parents=True, exist_ok=True)
        with open(dest_path, "wb") as f:
            f.write(resp.content)
        return dest_path

    # --- Chunks ---

    def create_chunk(self, upload_id: str, chunk_index: int, content: str, metadata: dict | None = None) -> dict:
        resp = self.http.post(
            f"{self.api_url}/api/worker/chunks",
            json={
                "upload_id": upload_id,
                "chunk_index": chunk_index,
                "content": content,
                "metadata": metadata or {},
            },
        )
        resp.raise_for_status()
        return resp.json()

    # --- Dataset ---

    def batch_create_dataset(self, project_id: str, items: list[dict]) -> int:
        resp = self.http.post(
            f"{self.api_url}/api/worker/dataset/batch",
            json={"project_id": project_id, "items": items},
            timeout=120,
        )
        resp.raise_for_status()
        return resp.json().get("inserted", 0)

    def get_dataset(self, project_id: str, eval_only: bool = False) -> list[dict]:
        params: dict[str, str] = {"limit": "10000"}
        if eval_only:
            params["eval_only"] = "true"
        resp = self.http.get(
            f"{self.api_url}/api/projects/{project_id}/dataset",
            params=params,
        )
        resp.raise_for_status()
        return resp.json().get("items", [])

    # --- Training runs ---

    def get_training_run(self, training_run_id: str) -> dict:
        resp = self.http.get(f"{self.api_url}/api/worker/training-runs/{training_run_id}")
        resp.raise_for_status()
        return resp.json()

    def update_training_progress(
        self,
        training_run_id: str,
        epoch: int,
        loss: float | None = None,
        current_step: int = 0,
        total_steps: int | None = None,
        grad_norm: float | None = None,
        learning_rate: float | None = None,
    ) -> None:
        body: dict = {"status": "training", "epoch": epoch, "loss": loss, "current_step": current_step}
        if total_steps is not None:
            body["total_steps"] = total_steps
        if grad_norm is not None:
            body["grad_norm"] = grad_norm
        if learning_rate is not None:
            body["learning_rate"] = learning_rate
        self.http.patch(
            f"{self.api_url}/api/worker/training-runs/{training_run_id}/progress",
            json=body,
        )

    def update_training_logs(self, training_run_id: str, logs: str) -> None:
        self.http.put(
            f"{self.api_url}/api/worker/training-runs/{training_run_id}/logs",
            json={"logs": logs},
        )

    def complete_training_run(self, training_run_id: str, output_path: str) -> None:
        self.http.post(
            f"{self.api_url}/api/worker/training-runs/{training_run_id}/complete",
            json={"output_path": output_path},
        )

    def fail_training_run(self, training_run_id: str, error: str) -> None:
        self.http.post(
            f"{self.api_url}/api/worker/training-runs/{training_run_id}/fail",
            json={"error": error},
        )

    def set_hf_job_id(self, training_run_id: str, job_id: str) -> None:
        self.http.post(
            f"{self.api_url}/api/worker/training-runs/{training_run_id}/hf-job",
            json={"job_id": job_id},
        )

    def set_hf_dataset_repo(self, training_run_id: str, repo_id: str) -> None:
        self.http.post(
            f"{self.api_url}/api/worker/training-runs/{training_run_id}/hf-dataset-repo",
            json={"repo_id": repo_id},
        )

    def set_trackio_url(self, training_run_id: str, url: str) -> None:
        self.http.post(
            f"{self.api_url}/api/worker/training-runs/{training_run_id}/trackio-url",
            json={"url": url},
        )

    def set_training_hf_repo(self, training_run_id: str, repo_id: str) -> None:
        self.http.post(
            f"{self.api_url}/api/worker/training-runs/{training_run_id}/hf-repo",
            json={"repo_id": repo_id},
        )

    # --- Chat sessions ---

    def update_chat_session_status(self, session_id: str, status: str) -> None:
        self.http.patch(
            f"{self.api_url}/api/worker/chat-sessions/{session_id}/status",
            json={"status": status},
        )

    def get_pending_chat_message(self, session_id: str) -> dict | None:
        resp = self.http.get(
            f"{self.api_url}/api/worker/chat-sessions/{session_id}/pending-message",
        )
        if resp.status_code == 204:
            return None
        resp.raise_for_status()
        return resp.json()

    def list_chat_messages(self, session_id: str) -> list[dict]:
        resp = self.http.get(
            f"{self.api_url}/api/worker/chat-sessions/{session_id}/messages",
        )
        resp.raise_for_status()
        return resp.json()

    def update_chat_message(self, message_id: str, content: str, status: str) -> None:
        self.http.patch(
            f"{self.api_url}/api/worker/chat-messages/{message_id}",
            json={"content": content, "status": status},
        )

    # --- Benchmarks ---

    def create_benchmark(self, training_run_id: str, project_id: str, model_type: str, epoch: int | None = None) -> dict:
        resp = self.http.post(
            f"{self.api_url}/api/worker/benchmarks",
            json={
                "training_run_id": training_run_id,
                "project_id": project_id,
                "model_type": model_type,
                "epoch": epoch,
            },
        )
        resp.raise_for_status()
        return resp.json()

    def complete_benchmark(
        self,
        benchmark_id: str,
        accuracy: float,
        avg_score: float,
        total_questions: int,
        results: list[dict],
        semantic_similarity: float | None = None,
        rouge_l: float | None = None,
    ) -> None:
        body: dict = {
            "accuracy": accuracy,
            "avg_score": avg_score,
            "total_questions": total_questions,
            "results": results,
        }
        if semantic_similarity is not None:
            body["semantic_similarity"] = semantic_similarity
        if rouge_l is not None:
            body["rouge_l"] = rouge_l
        self.http.post(
            f"{self.api_url}/api/worker/benchmarks/{benchmark_id}/complete",
            json=body,
            timeout=120,
        )
