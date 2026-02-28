import time
import traceback

from worker.config import Config
from worker.client import APIClient
from worker.jobs import harness, training, benchmark
from worker.hf import upload as hf_upload


def main():
    config = Config()
    client = APIClient(api_url=config.api_url, worker_id=config.worker_id)

    print(f"Worker starting | api={config.api_url} | id={config.worker_id}")

    while True:
        try:
            job = client.poll_job()
        except Exception:
            print("Failed to poll, retrying...")
            time.sleep(config.poll_interval)
            continue

        if job is None:
            time.sleep(config.poll_interval)
            continue

        job_id = job["id"]
        job_type = job["job_type"]
        print(f"Claimed job {job_id} | type={job_type}")

        payload = job.get("payload", {})
        if isinstance(payload, str):
            import json
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
                # Ensure training run is marked failed so it doesn't stay stuck
                try:
                    training_run_id = payload.get("training_run_id", "")
                    if training_run_id:
                        client.fail_training_run(training_run_id, str(e))
                        client.update_project_status(project_id, "created")
                except Exception:
                    print(f"Failed to mark training run as failed")
            print(f"Failed job {job_id}: {e}")


if __name__ == "__main__":
    main()
