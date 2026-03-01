"""Auto-benchmark: evaluate base, per-epoch fine-tuned, teacher, and final fine-tuned models."""

import json
import os
import re
import time

from worker.client import APIClient
from worker.jobs.metrics import compute_metrics
from worker.llm import LLMClient, create_llm_client


OUTPUT_DIR = os.environ.get("ECOLE_MODEL_DIR", "/tmp/ecole_models")
HF_BENCHMARK_ENTRY_SCRIPT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
    "scripts",
    "hf_benchmark_entry.py",
)

# Default GPU flavor mapping (used as fallback when no flavor is specified)
DEFAULT_HF_FLAVORS = {
    "mistralai/Ministral-3-3B-Reasoning-2512": "a10g-small",
    "mistralai/Ministral-3-8B-Reasoning-2512": "a10g-large",
}

JUDGE_SYSTEM = """You are an expert evaluator. Score the model's answer to the question \
on a scale of 1 to 5 based on accuracy, completeness, and relevance.

1 = Completely wrong or irrelevant
2 = Partially relevant but mostly incorrect
3 = Somewhat correct but missing key information
4 = Mostly correct with minor gaps
5 = Fully correct and comprehensive"""

JUDGE_PROMPT = """## Question
{question}

## Expected Answer
{expected}

## Model Answer
{answer}

Rate the model's answer on a scale of 1-5. Return ONLY a JSON object:
{{"score": <1-5>, "reason": "<brief explanation>"}}"""


def run(client: APIClient, job: dict) -> None:
    """Execute the auto-benchmark pipeline."""
    payload = job.get("payload", {})
    if isinstance(payload, str):
        payload = json.loads(payload)
    project_id = payload.get("project_id", job.get("project_id"))
    training_run_id = payload["training_run_id"]

    print(f"[benchmark] Starting for project {project_id}, run {training_run_id}")

    # Get training run info
    run_info = client.get_training_run(training_run_id)
    compute_mode = run_info.get("compute_mode", "local")

    if compute_mode == "hf_jobs":
        _run_hf_jobs(client, job, project_id, training_run_id, run_info)
    else:
        _run_local(client, job, project_id, training_run_id, run_info)


def _run_local(
    client: APIClient,
    job: dict,
    project_id: str,
    training_run_id: str,
    run_info: dict,
) -> None:
    """Run the full benchmark pipeline locally with GPU."""
    import torch
    from peft import PeftModel
    from transformers import AutoConfig, AutoModelForCausalLM, AutoTokenizer

    # Get project context and API keys
    project = client.get_project(project_id)
    keys = client.get_api_keys(project_id)

    # Read LLM provider from project context (default: anthropic)
    context = project.get("context", {})
    if isinstance(context, str):
        context = json.loads(context) if context else {}

    provider = context.get("llm_provider", "anthropic")

    # Fall back to env vars if keys not set in DB
    if provider == "anthropic" and not keys.get("anthropic_key"):
        env_key = os.getenv("ANTHROPIC_API_KEY", "")
        if env_key:
            keys["anthropic_key"] = env_key
    if provider == "mistral" and not keys.get("mistral_key"):
        env_key = os.getenv("MISTRAL_API_KEY", "")
        if env_key:
            keys["mistral_key"] = env_key

    llm = create_llm_client(provider, keys)

    print(f"[benchmark:local] Using LLM provider: {provider}")

    base_model = run_info["base_model"]
    adapter_path = run_info.get("output_model_path")

    # Get eval dataset
    eval_items = client.get_dataset(project_id, eval_only=True)
    if not eval_items:
        raise ValueError("No eval data available. Generate a dataset first.")

    print(f"[benchmark:local] {len(eval_items)} eval questions")

    # --- 1. Base model evaluation ---
    print(f"[benchmark:local] Evaluating base model: {base_model}")
    base_benchmark = client.create_benchmark(
        training_run_id=training_run_id,
        project_id=project_id,
        model_type="base",
    )

    base_results = _evaluate_model(
        llm=llm,
        model_name=base_model,
        adapter_path=None,
        eval_items=eval_items,
        client=client,
        job_id=job["id"],
        label="base",
    )

    _save_benchmark(client, base_benchmark["id"], base_results)

    # --- 2. Per-epoch fine-tuned + final adapter evaluation ---
    if adapter_path:
        _evaluate_per_epoch(
            client=client,
            llm=llm,
            base_model=base_model,
            adapter_path=adapter_path,
            eval_items=eval_items,
            job=job,
            training_run_id=training_run_id,
            project_id=project_id,
        )

        # Final adapter evaluation (epoch=null)
        if os.path.exists(adapter_path):
            print(f"[benchmark:local] Evaluating final fine-tuned model: {base_model} + {adapter_path}")
            ft_benchmark = client.create_benchmark(
                training_run_id=training_run_id,
                project_id=project_id,
                model_type="finetuned",
            )

            ft_results = _evaluate_model(
                llm=llm,
                model_name=base_model,
                adapter_path=adapter_path,
                eval_items=eval_items,
                client=client,
                job_id=job["id"],
                label="finetuned",
            )

            _save_benchmark(client, ft_benchmark["id"], ft_results)
        else:
            print(f"[benchmark:local] Skipping fine-tuned eval (no adapter at {adapter_path})")
    else:
        print("[benchmark:local] Skipping fine-tuned eval (no adapter path)")

    # --- 3. Teacher model evaluation ---
    print(f"[benchmark:local] Evaluating teacher model ({provider})")
    _evaluate_teacher(
        client=client,
        llm=llm,
        eval_items=eval_items,
        job=job,
        training_run_id=training_run_id,
        project_id=project_id,
    )

    # Update project status
    client.update_project_status(project_id, "benchmarked")
    print(f"[benchmark:local] Done for {training_run_id}")


def _run_hf_jobs(
    client: APIClient,
    job: dict,
    project_id: str,
    training_run_id: str,
    run_info: dict,
) -> None:
    """Dispatch GPU inference to HF Jobs, then score results locally."""
    from datasets import Dataset
    from huggingface_hub import HfApi, fetch_job_logs, inspect_job, run_uv_job

    base_model = run_info["base_model"]
    adapter_path = run_info.get("output_model_path")  # e.g. "hf://owner/repo"

    # Get API keys
    keys = client.get_api_keys(project_id)
    hf_token = keys.get("hf_token") or os.getenv("HF_TOKEN", "")
    if not hf_token:
        raise ValueError("HuggingFace token required for HF Jobs compute mode.")

    # Get eval dataset
    eval_items = client.get_dataset(project_id, eval_only=True)
    if not eval_items:
        raise ValueError("No eval data available. Generate a dataset first.")

    print(f"[benchmark:hf_jobs] {len(eval_items)} eval questions")

    # Build repo names
    project = client.get_project(project_id)
    project_name = project.get("name", "model").lower().replace(" ", "-")

    hf_namespace = run_info.get("hf_namespace")
    hf_api = HfApi(token=hf_token)

    if hf_namespace:
        owner = hf_namespace
    else:
        user_info = hf_api.whoami()
        owner = user_info.get("name", user_info.get("user", "user"))

    eval_dataset_repo = f"{owner}/ecole-{project_name}-eval-{training_run_id[:8]}"
    output_repo = f"{owner}/ecole-{project_name}-bench-results-{training_run_id[:8]}"

    # Push eval dataset to HF Hub
    eval_records = [
        {"question": item["question"], "expected": item["answer"]}
        for item in eval_items
    ]
    ds = Dataset.from_list(eval_records)
    hf_api.create_repo(eval_dataset_repo, repo_type="dataset", exist_ok=True, private=True)
    ds.push_to_hub(eval_dataset_repo, token=hf_token, private=True)
    print(f"[benchmark:hf_jobs] Eval dataset pushed to {eval_dataset_repo}")

    # Determine adapter repo (strip hf:// prefix)
    adapter_repo = ""
    if adapter_path and adapter_path.startswith("hf://"):
        adapter_repo = adapter_path[len("hf://"):]

    # Select GPU flavor
    flavor = run_info.get("hf_flavor") or DEFAULT_HF_FLAVORS.get(base_model, "a10g-small")

    # Estimate timeout: generous for inference
    estimated_minutes = max(30, len(eval_items) * 2)
    timeout = f"{min(estimated_minutes, 360)}m"

    print(f"[benchmark:hf_jobs] Dispatching to HF Jobs: flavor={flavor}, timeout={timeout}")

    # Dispatch the job
    env = {
        "ECOLE_BASE_MODEL": base_model,
        "ECOLE_EVAL_DATASET_REPO": eval_dataset_repo,
        "ECOLE_OUTPUT_REPO": output_repo,
    }
    if adapter_repo:
        env["ECOLE_ADAPTER_REPO"] = adapter_repo

    job_kwargs = dict(
        flavor=flavor,
        timeout=timeout,
        env=env,
        secrets={"HF_TOKEN": hf_token},
        token=hf_token,
    )
    if hf_namespace:
        job_kwargs["namespace"] = hf_namespace

    hf_job = run_uv_job(HF_BENCHMARK_ENTRY_SCRIPT, **job_kwargs)

    hf_job_id = hf_job.id
    hf_job_url = getattr(hf_job, "url", None) or f"https://huggingface.co/jobs/{hf_job_id}"
    print(f"[benchmark:hf_jobs] Dispatched HF Job: {hf_job_id} — {hf_job_url}")

    # Save HF job URL
    client.set_hf_job_id(training_run_id, hf_job_url)

    # Poll for completion
    poll_interval = 30
    max_poll_failures = 5
    consecutive_failures = 0

    while True:
        time.sleep(poll_interval)

        try:
            job_info = inspect_job(job_id=hf_job_id, token=hf_token)
            consecutive_failures = 0
        except Exception as e:
            consecutive_failures += 1
            print(f"[benchmark:hf_jobs] Failed to inspect job {hf_job_id} ({consecutive_failures}/{max_poll_failures}): {e}")
            if consecutive_failures >= max_poll_failures:
                raise RuntimeError(
                    f"Lost contact with HF Job {hf_job_id} after {max_poll_failures} poll failures: {e}"
                )
            continue

        stage = job_info.status.stage
        print(f"[benchmark:hf_jobs] Job {hf_job_id} status: {stage}")

        # Report progress
        if stage in ("RUNNING", "COMPLETED", "ERROR"):
            try:
                log_text = "".join(fetch_job_logs(job_id=hf_job_id, token=hf_token))
                if log_text:
                    client.report_progress(job["id"], {
                        "status": "running",
                        "label": "hf_inference",
                        "log_tail": log_text[-2000:],
                    })
            except Exception as e:
                print(f"[benchmark:hf_jobs] Failed to fetch logs: {e}")

        if stage == "COMPLETED":
            print(f"[benchmark:hf_jobs] HF Job completed, downloading results from {output_repo}")
            break

        elif stage == "ERROR":
            error_msg = job_info.status.message or "HF Benchmark Job failed"
            raise RuntimeError(f"HF Benchmark Job failed: {error_msg}")

        # QUEUED, STARTING, RUNNING — keep polling

    # Download results from HF Hub
    from datasets import load_dataset as hf_load_dataset

    results_ds = hf_load_dataset(output_repo, split="train", token=hf_token)
    raw_results = [dict(row) for row in results_ds]

    # Split by model_type
    base_raw = [r for r in raw_results if r.get("model_type") == "base"]
    ft_raw = [r for r in raw_results if r.get("model_type") == "finetuned"]

    print(f"[benchmark:hf_jobs] Downloaded {len(base_raw)} base + {len(ft_raw)} finetuned results")

    # Set up LLM client for judging
    project_data = client.get_project(project_id)
    context = project_data.get("context", {})
    if isinstance(context, str):
        context = json.loads(context) if context else {}

    provider = context.get("llm_provider", "anthropic")

    if provider == "anthropic" and not keys.get("anthropic_key"):
        env_key = os.getenv("ANTHROPIC_API_KEY", "")
        if env_key:
            keys["anthropic_key"] = env_key
    if provider == "mistral" and not keys.get("mistral_key"):
        env_key = os.getenv("MISTRAL_API_KEY", "")
        if env_key:
            keys["mistral_key"] = env_key

    llm = create_llm_client(provider, keys)
    print(f"[benchmark:hf_jobs] Using LLM provider: {provider}")

    # --- Score base results ---
    if base_raw:
        print(f"[benchmark:hf_jobs] Scoring {len(base_raw)} base model answers")
        base_benchmark = client.create_benchmark(
            training_run_id=training_run_id,
            project_id=project_id,
            model_type="base",
        )
        base_results = _score_raw_answers(llm, base_raw, client, job["id"], "base")
        _save_benchmark(client, base_benchmark["id"], base_results)

    # --- Score finetuned results ---
    if ft_raw:
        print(f"[benchmark:hf_jobs] Scoring {len(ft_raw)} finetuned model answers")
        ft_benchmark = client.create_benchmark(
            training_run_id=training_run_id,
            project_id=project_id,
            model_type="finetuned",
        )
        ft_results = _score_raw_answers(llm, ft_raw, client, job["id"], "finetuned")
        _save_benchmark(client, ft_benchmark["id"], ft_results)

    # --- Teacher model evaluation (API-based, runs locally) ---
    print(f"[benchmark:hf_jobs] Evaluating teacher model ({provider})")
    _evaluate_teacher(
        client=client,
        llm=llm,
        eval_items=eval_items,
        job=job,
        training_run_id=training_run_id,
        project_id=project_id,
    )

    # Update project status
    client.update_project_status(project_id, "benchmarked")
    print(f"[benchmark:hf_jobs] Done for {training_run_id}")


def _score_raw_answers(
    llm: LLMClient,
    raw_entries: list[dict],
    client: APIClient,
    job_id: str,
    label: str,
) -> list[dict]:
    """Score raw {question, expected, answer} entries with LLM judge + deterministic metrics."""
    results = []
    for i, entry in enumerate(raw_entries):
        question = entry["question"]
        expected = entry["expected"]
        answer = entry["answer"]

        score_data = _judge_answer(llm, question, expected, answer)
        metrics = compute_metrics(answer, expected)

        results.append({
            "question": question,
            "expected": expected,
            "answer": answer,
            "score": score_data.get("score", 0),
            "reason": score_data.get("reason", ""),
            "semantic_similarity": metrics["semantic_similarity"],
            "rouge_l": metrics["rouge_l"],
        })

        if (i + 1) % 5 == 0 or i == len(raw_entries) - 1:
            client.report_progress(job_id, {
                "status": "running",
                "label": f"scoring-{label}",
                "evaluated": i + 1,
                "total": len(raw_entries),
            })
            print(f"[benchmark] scoring-{label}: {i + 1}/{len(raw_entries)}")

    return results


def _evaluate_per_epoch(
    client: APIClient,
    llm: LLMClient,
    base_model: str,
    adapter_path: str,
    eval_items: list[dict],
    job: dict,
    training_run_id: str,
    project_id: str,
) -> None:
    """Discover per-epoch checkpoint dirs and evaluate each."""
    # Checkpoints are in the parent directory of the final adapter
    parent_dir = os.path.dirname(adapter_path)
    if not os.path.isdir(parent_dir):
        print(f"[benchmark] No parent dir for checkpoints: {parent_dir}")
        return

    # Find checkpoint-* directories, sorted by epoch number
    checkpoint_dirs = []
    for name in os.listdir(parent_dir):
        match = re.match(r"checkpoint-(\d+)", name)
        if match:
            checkpoint_path = os.path.join(parent_dir, name)
            if os.path.isdir(checkpoint_path):
                checkpoint_dirs.append((int(match.group(1)), checkpoint_path))

    checkpoint_dirs.sort(key=lambda x: x[0])

    if not checkpoint_dirs:
        print("[benchmark] No epoch checkpoints found, skipping per-epoch eval")
        return

    print(f"[benchmark] Found {len(checkpoint_dirs)} epoch checkpoints")

    for epoch_idx, (step, ckpt_path) in enumerate(checkpoint_dirs, start=1):
        print(f"[benchmark] Evaluating epoch {epoch_idx} checkpoint: {ckpt_path}")
        epoch_benchmark = client.create_benchmark(
            training_run_id=training_run_id,
            project_id=project_id,
            model_type="finetuned",
            epoch=epoch_idx,
        )

        epoch_results = _evaluate_model(
            llm=llm,
            model_name=base_model,
            adapter_path=ckpt_path,
            eval_items=eval_items,
            client=client,
            job_id=job["id"],
            label=f"finetuned-epoch-{epoch_idx}",
        )

        _save_benchmark(client, epoch_benchmark["id"], epoch_results)


def _evaluate_teacher(
    client: APIClient,
    llm: LLMClient,
    eval_items: list[dict],
    job: dict,
    training_run_id: str,
    project_id: str,
) -> None:
    """Evaluate the teacher LLM (Claude/Mistral) on the eval set."""
    teacher_benchmark = client.create_benchmark(
        training_run_id=training_run_id,
        project_id=project_id,
        model_type="teacher",
    )

    results = []
    for i, item in enumerate(eval_items):
        question = item["question"]
        expected = item["answer"]

        # Generate answer from teacher LLM
        try:
            answer = llm.answer_question(question)
        except Exception as e:
            print(f"[benchmark] Teacher answer error: {e}")
            answer = f"Error: {e}"

        # Score with LLM judge
        score_data = _judge_answer(llm, question, expected, answer)

        # Compute deterministic metrics
        metrics = compute_metrics(answer, expected)

        results.append({
            "question": question,
            "expected": expected,
            "answer": answer,
            "score": score_data.get("score", 0),
            "reason": score_data.get("reason", ""),
            "semantic_similarity": metrics["semantic_similarity"],
            "rouge_l": metrics["rouge_l"],
        })

        if (i + 1) % 5 == 0 or i == len(eval_items) - 1:
            client.report_progress(job["id"], {
                "status": "running",
                "label": "teacher",
                "evaluated": i + 1,
                "total": len(eval_items),
            })
            print(f"[benchmark] teacher: {i + 1}/{len(eval_items)}")

    _save_benchmark(client, teacher_benchmark["id"], results)


def _evaluate_model(
    llm: LLMClient,
    model_name: str,
    adapter_path: str | None,
    eval_items: list[dict],
    client: APIClient,
    job_id: str,
    label: str,
) -> list[dict]:
    """Load a model, generate answers for eval items, and score with the LLM judge."""
    import torch
    from peft import PeftModel
    from transformers import AutoConfig, AutoModelForCausalLM, AutoTokenizer

    # Load tokenizer
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    # Load model (handle multimodal models like Ministral 3)
    config = AutoConfig.from_pretrained(model_name)
    if config.model_type == "mistral3":
        from transformers import Mistral3ForConditionalGeneration
        model = Mistral3ForConditionalGeneration.from_pretrained(
            model_name, dtype=torch.bfloat16, device_map="auto",
        )
    else:
        model = AutoModelForCausalLM.from_pretrained(
            model_name, dtype=torch.bfloat16, device_map="auto",
        )

    # Apply adapter if provided
    if adapter_path:
        model = PeftModel.from_pretrained(model, adapter_path)

    model.eval()

    results = []
    for i, item in enumerate(eval_items):
        question = item["question"]
        expected = item["answer"]

        # Generate answer
        answer = _generate_answer(model, tokenizer, question)

        # Score with LLM judge
        score_data = _judge_answer(llm, question, expected, answer)

        # Compute deterministic metrics
        metrics = compute_metrics(answer, expected)

        results.append({
            "question": question,
            "expected": expected,
            "answer": answer,
            "score": score_data.get("score", 0),
            "reason": score_data.get("reason", ""),
            "semantic_similarity": metrics["semantic_similarity"],
            "rouge_l": metrics["rouge_l"],
        })

        if (i + 1) % 5 == 0 or i == len(eval_items) - 1:
            client.report_progress(job_id, {
                "status": "running",
                "label": label,
                "evaluated": i + 1,
                "total": len(eval_items),
            })
            print(f"[benchmark] {label}: {i + 1}/{len(eval_items)}")

    # Cleanup
    del model
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    return results


def _generate_answer(model, tokenizer, question: str, max_new_tokens: int = 512) -> str:
    """Generate an answer from the model."""
    import torch

    messages = [{"role": "user", "content": question}]

    # Try chat template, fall back to plain prompt
    try:
        input_text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    except Exception:
        input_text = f"Question: {question}\nAnswer:"

    inputs = tokenizer(input_text, return_tensors="pt").to(model.device)

    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=False,
            temperature=1.0,
            pad_token_id=tokenizer.pad_token_id,
        )

    # Decode only the generated tokens
    generated = outputs[0][inputs["input_ids"].shape[1]:]
    return tokenizer.decode(generated, skip_special_tokens=True).strip()


def _judge_answer(llm: LLMClient, question: str, expected: str, answer: str) -> dict:
    """Use LLM as a judge to score the answer."""
    try:
        content_blocks = [{
            "type": "text",
            "text": JUDGE_PROMPT.format(
                question=question,
                expected=expected,
                answer=answer,
            ),
        }]

        response = llm.generate(
            system=JUDGE_SYSTEM,
            content_blocks=content_blocks,
            max_tokens=256,
            use_vision=False,
        )

        text = response.text.strip()

        # Extract JSON
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0]
        elif "```" in text:
            text = text.split("```")[1].split("```")[0]

        result = json.loads(text.strip())
        score = int(result.get("score", 0))
        if score < 1 or score > 5:
            score = 0
        return {"score": score, "reason": result.get("reason", "")}

    except (json.JSONDecodeError, IndexError, KeyError) as e:
        print(f"[benchmark] Judge error: {e}")
        return {"score": 0, "reason": f"Judging failed: {e}"}
    except Exception as e:
        print(f"[benchmark] Judge error: {e}")
        return {"score": 0, "reason": f"Judging failed: {e}"}


def _save_benchmark(client: APIClient, benchmark_id: str, results: list[dict]) -> None:
    """Compute metrics and save benchmark results."""
    scores = [r["score"] for r in results if r["score"] > 0]

    total = len(results)
    avg_score = sum(scores) / len(scores) if scores else 0.0
    # Accuracy = fraction scoring 4 or 5
    accurate = sum(1 for s in scores if s >= 4)
    accuracy = accurate / total if total > 0 else 0.0

    # Aggregate deterministic metrics
    sim_scores = [r["semantic_similarity"] for r in results if r.get("semantic_similarity") is not None]
    rouge_scores = [r["rouge_l"] for r in results if r.get("rouge_l") is not None]

    avg_semantic_similarity = sum(sim_scores) / len(sim_scores) if sim_scores else None
    avg_rouge_l = sum(rouge_scores) / len(rouge_scores) if rouge_scores else None

    client.complete_benchmark(
        benchmark_id=benchmark_id,
        accuracy=accuracy,
        avg_score=avg_score,
        total_questions=total,
        results=results,
        semantic_similarity=avg_semantic_similarity,
        rouge_l=avg_rouge_l,
    )

    sim_str = f"{avg_semantic_similarity:.3f}" if avg_semantic_similarity is not None else "n/a"
    rouge_str = f"{avg_rouge_l:.3f}" if avg_rouge_l is not None else "n/a"
    print(f"[benchmark] Saved: avg_score={avg_score:.2f}, accuracy={accuracy:.2%}, sem_sim={sim_str}, rouge_l={rouge_str}, n={total}")
