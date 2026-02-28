"""Auto-benchmark: evaluate base and fine-tuned models using LLM-as-judge."""

import json
import os

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

from worker.client import APIClient
from worker.llm import LLMClient, create_llm_client


OUTPUT_DIR = os.environ.get("ECOLE_MODEL_DIR", "/tmp/ecole_models")

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

    print(f"[benchmark] Using LLM provider: {provider}")

    # Get training run info
    run_info = client.get_training_run(training_run_id)
    base_model = run_info["base_model"]
    adapter_path = run_info.get("output_model_path")

    # Get eval dataset
    eval_items = client.get_dataset(project_id, eval_only=True)
    if not eval_items:
        raise ValueError("No eval data available. Generate a dataset first.")

    print(f"[benchmark] {len(eval_items)} eval questions")

    # --- Base model evaluation ---
    print(f"[benchmark] Evaluating base model: {base_model}")
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

    # --- Fine-tuned model evaluation ---
    if adapter_path and os.path.exists(adapter_path):
        print(f"[benchmark] Evaluating fine-tuned model: {base_model} + {adapter_path}")
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
        print(f"[benchmark] Skipping fine-tuned eval (no adapter at {adapter_path})")

    # Update project status
    client.update_project_status(project_id, "benchmarked")
    print(f"[benchmark] Done for {training_run_id}")


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
    # Load tokenizer
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    # Load model
    model = AutoModelForCausalLM.from_pretrained(
        model_name,
        torch_dtype=torch.bfloat16,
        device_map="auto",
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

        results.append({
            "question": question,
            "expected": expected,
            "answer": answer,
            "score": score_data.get("score", 0),
            "reason": score_data.get("reason", ""),
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

    client.complete_benchmark(
        benchmark_id=benchmark_id,
        accuracy=accuracy,
        avg_score=avg_score,
        total_questions=total,
        results=results,
    )

    print(f"[benchmark] Saved: avg_score={avg_score:.2f}, accuracy={accuracy:.2%}, n={total}")
