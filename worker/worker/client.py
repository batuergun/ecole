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

    def update_training_progress(self, training_run_id: str, epoch: int, loss: float | None = None) -> None:
        self.http.patch(
            f"{self.api_url}/api/worker/training-runs/{training_run_id}/progress",
            json={"status": "training", "epoch": epoch, "loss": loss},
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

    def set_training_hf_repo(self, training_run_id: str, repo_id: str) -> None:
        self.http.post(
            f"{self.api_url}/api/worker/training-runs/{training_run_id}/hf-repo",
            json={"repo_id": repo_id},
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

    def complete_benchmark(self, benchmark_id: str, accuracy: float, avg_score: float, total_questions: int, results: list[dict]) -> None:
        self.http.post(
            f"{self.api_url}/api/worker/benchmarks/{benchmark_id}/complete",
            json={
                "accuracy": accuracy,
                "avg_score": avg_score,
                "total_questions": total_questions,
                "results": results,
            },
            timeout=120,
        )
