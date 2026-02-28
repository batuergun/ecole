import os


class Config:
    api_url: str = os.getenv("API_URL", "http://localhost:8080")
    worker_id: str = os.getenv("WORKER_ID", "local-worker")
    poll_interval: int = int(os.getenv("POLL_INTERVAL", "5"))
