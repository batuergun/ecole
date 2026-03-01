import json
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, Future

from worker.config import Config
from worker.client import APIClient
from worker.jobs import harness, training, benchmark, chat
from worker.hf import upload as hf_upload

MAX_CONCURRENT_JOBS = 4


def _run_job(config: Config, job: dict) -> None:
    """Execute a single job in its own thread with a dedicated API client."""
    client = APIClient(api_url=config.api_url, worker_id=config.worker_id)

    job_id = job["id"]
    job_type = job["job_type"]

    payload = job.get("payload", {})
    if isinstance(payload, str):
        payload = json.loads(payload)

    project_id = job.get("project_id", "") or payload.get("project_id", "")

    try:
        if job_type == "harness":
            harness.run(client, job)
        elif job_type == "training":
            training.run(client, job)
        elif job_type == "benchmark":
            benchmark.run(client, job)
        elif job_type == "hf_upload":
            hf_upload.run(client, job)
        elif job_type == "chat_session":
            chat.run(client, job)
        else:
            raise ValueError(f"Unknown job type: {job_type}")

        client.complete_job(job_id)
        print(f"Completed job {job_id}")
    except Exception as e:
        traceback.print_exc()
        client.fail_job(job_id, str(e))
        if project_id and job_type == "harness":
            client.update_project_status(project_id, "created")
        elif project_id and job_type == "training":
            try:
                training_run_id = payload.get("training_run_id", "")
                if training_run_id:
                    client.fail_training_run(training_run_id, str(e))
                    client.update_project_status(project_id, "created")
            except Exception:
                print("Failed to mark training run as failed")
        elif project_id and job_type == "benchmark":
            try:
                client.update_project_status(project_id, "trained")
            except Exception:
                print("Failed to reset project status after benchmark failure")
        print(f"Failed job {job_id}: {e}")


def main():
    config = Config()
    poll_client = APIClient(api_url=config.api_url, worker_id=config.worker_id)

    print(f"Worker starting | api={config.api_url} | id={config.worker_id} | max_concurrent={MAX_CONCURRENT_JOBS}")

    executor = ThreadPoolExecutor(max_workers=MAX_CONCURRENT_JOBS)
    running: dict[str, Future] = {}

    while True:
        # Clean up finished futures
        done_ids = [jid for jid, fut in running.items() if fut.done()]
        for jid in done_ids:
            del running[jid]

        # Only poll if we have capacity
        if len(running) >= MAX_CONCURRENT_JOBS:
            time.sleep(config.poll_interval)
            continue

        try:
            job = poll_client.poll_job()
        except Exception:
            print("Failed to poll, retrying...")
            time.sleep(config.poll_interval)
            continue

        if job is None:
            time.sleep(config.poll_interval)
            continue

        job_id = job["id"]
        job_type = job["job_type"]
        print(f"Claimed job {job_id} | type={job_type} | running={len(running)}")

        future = executor.submit(_run_job, config, job)
        running[job_id] = future


if __name__ == "__main__":
    main()
