import httpx
from typing import Any


class APIClient:
    def __init__(self, api_url: str, worker_id: str):
        self.api_url = api_url.rstrip("/")
        self.worker_id = worker_id
        self.http = httpx.Client(timeout=30)

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

    def get_dataset(self, project_id: str, eval_only: bool = False) -> list[dict]:
        params = {"limit": "10000"}
        if eval_only:
            params["eval_only"] = "true"
        resp = self.http.get(
            f"{self.api_url}/api/projects/{project_id}/dataset",
            params=params,
        )
        resp.raise_for_status()
        return resp.json().get("items", [])

    def get_project(self, project_id: str) -> dict:
        resp = self.http.get(f"{self.api_url}/api/projects/{project_id}")
        resp.raise_for_status()
        return resp.json()

    def get_uploads(self, project_id: str) -> list[dict]:
        resp = self.http.get(f"{self.api_url}/api/projects/{project_id}/uploads")
        resp.raise_for_status()
        return resp.json()
