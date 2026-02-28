import time
import traceback

from worker.config import Config
from worker.client import APIClient
from worker.jobs import harness, training, benchmark


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

        try:
            if job_type == "harness":
                harness.run(client, job)
            elif job_type == "training":
                training.run(client, job)
            elif job_type == "benchmark":
                benchmark.run(client, job)
            else:
                raise ValueError(f"Unknown job type: {job_type}")

            client.complete_job(job_id)
            print(f"Completed job {job_id}")
        except Exception as e:
            traceback.print_exc()
            client.fail_job(job_id, str(e))
            print(f"Failed job {job_id}: {e}")


if __name__ == "__main__":
    main()
