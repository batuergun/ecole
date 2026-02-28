"""Auto-harness: extract data from uploads and generate Q&A pairs using an LLM."""

import json
import os
import random
import tempfile

from worker.client import APIClient
from worker.llm import LLMClient, create_llm_client
from worker.pdf.extract import extract_pdf_pages, chunk_text, chunk_text_with_positions


DEFAULT_QA_PER_CHUNK = 10
EVAL_RATIO = 0.1

SYSTEM_PROMPT = """You are a training data generator for fine-tuning language models. \
Your job is to create high-quality question-answer pairs from source material that will \
be used to teach a model domain-specific knowledge."""

QA_GENERATION_PROMPT = """Generate {n} diverse question-answer pairs from the following source material.

{context_section}

## Source Material
{content}

## Requirements
- Questions should be natural and varied: factual recall, inferential reasoning, application-based, and comparative
- Answers should be comprehensive but concise
- Each Q&A pair must be self-contained (understandable without seeing the source)
- Vary question complexity from simple to advanced
{format_instructions}

## Output Format
Return a JSON array only, no other text:
[
  {{"question": "...", "answer": "..."}},
  ...
]"""


def run(client: APIClient, job: dict) -> None:
    """Execute the auto-harness pipeline."""
    payload = job.get("payload", {})
    if isinstance(payload, str):
        payload = json.loads(payload)
    project_id = payload.get("project_id", job.get("project_id"))
    job_id = job["id"]

    print(f"[harness] Starting for project {project_id}")

    # Get project context and API keys
    project = client.get_project(project_id)
    keys = client.get_api_keys(project_id)

    # Read LLM provider from project context (default: anthropic)
    context = project.get("context", {})
    if isinstance(context, str):
        context = json.loads(context) if context else {}

    provider = context.get("llm_provider", "anthropic")

    try:
        qa_per_chunk = int(context.get("qa_per_chunk", DEFAULT_QA_PER_CHUNK))
    except (ValueError, TypeError):
        qa_per_chunk = DEFAULT_QA_PER_CHUNK
    qa_per_chunk = max(1, min(20, qa_per_chunk))

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

    print(f"[harness] Using LLM provider: {provider} | qa_per_chunk: {qa_per_chunk}")

    context_section = _build_context_section(context)

    # Get uploads
    uploads = client.get_uploads(project_id)
    if not uploads:
        raise ValueError("No files uploaded to this project")

    all_qa_items: list[dict] = []
    total_chunks = 0

    for upload in uploads:
        print(f"[harness] Processing: {upload['filename']}")

        # Download file
        with tempfile.TemporaryDirectory() as tmpdir:
            local_path = os.path.join(tmpdir, upload["filename"])
            client.download_file(upload["storage_key"], local_path)

            mime = upload.get("mime_type", "")

            if mime == "application/pdf" or upload["filename"].lower().endswith(".pdf"):
                chunks = _process_pdf(client, llm, upload, local_path, context_section, context, qa_per_chunk)
            else:
                chunks = _process_text(client, llm, upload, local_path, context_section, context, qa_per_chunk)

            total_chunks += len(chunks)
            all_qa_items.extend(chunks)

            client.report_progress(job_id, {
                "status": "running",
                "processed_files": uploads.index(upload) + 1,
                "total_files": len(uploads),
                "total_qa_pairs": len(all_qa_items),
            })

    if not all_qa_items:
        raise ValueError("No Q&A pairs generated from the uploaded data")

    # Mark ~10% as eval
    random.shuffle(all_qa_items)
    eval_count = max(1, int(len(all_qa_items) * EVAL_RATIO))
    for i, item in enumerate(all_qa_items):
        item["is_eval"] = i < eval_count

    # Batch insert into database
    BATCH_SIZE = 50
    for i in range(0, len(all_qa_items), BATCH_SIZE):
        batch = all_qa_items[i : i + BATCH_SIZE]
        client.batch_create_dataset(project_id, batch)

    # Update project status
    client.update_project_status(project_id, "dataset_ready")

    print(f"[harness] Done: {len(all_qa_items)} Q&A pairs from {total_chunks} chunks")


def _build_context_section(context: dict) -> str:
    """Build the context instructions section from project settings."""
    parts = []
    if context.get("purpose"):
        parts.append(f"**Model Purpose:** {context['purpose']}")
    if context.get("response_format"):
        parts.append(f"**Expected Response Format:** {context['response_format']}")
    if context.get("self_awareness"):
        parts.append(f"**Model Identity:** {context['self_awareness']}")

    if not parts:
        return ""

    return "## Context About the Target Model\n" + "\n".join(parts)


def _process_pdf(
    client: APIClient,
    llm: LLMClient,
    upload: dict,
    local_path: str,
    context_section: str,
    context: dict,
    qa_per_chunk: int = DEFAULT_QA_PER_CHUNK,
) -> list[dict]:
    """Process a PDF file: combine text, sub-chunk, and generate Q&A with page images."""
    pages = extract_pdf_pages(local_path)

    # Build combined text and track page boundaries
    combined = ""
    page_boundaries: list[tuple[int, int, int]] = []  # (page_idx, start, end)
    page_images: dict[int, str] = {}
    image_only_pages: list[dict] = []

    for page_data in pages:
        idx = page_data["page"]
        if page_data.get("image_base64"):
            page_images[idx] = page_data["image_base64"]

        text = page_data["text"]
        if text.strip():
            start = len(combined)
            combined += text + "\n\n"
            page_boundaries.append((idx, start, len(combined)))
        elif page_data.get("image_base64"):
            image_only_pages.append(page_data)

    all_items: list[dict] = []
    format_instructions = _build_format_instructions(context)
    chunk_index = 0

    # Sub-chunk the combined text (smaller chunks = more training data)
    if combined.strip():
        text_chunks = chunk_text_with_positions(combined, chunk_size=2000, overlap=200)
        print(f"[harness] PDF text: {len(combined)} chars -> {len(text_chunks)} chunks")

        for chunk_content, chunk_start, chunk_end in text_chunks:
            if not chunk_content.strip():
                continue

            # Find which pages this chunk overlaps with
            relevant_pages = [
                pidx for pidx, ps, pe in page_boundaries
                if ps < chunk_end and pe > chunk_start
            ]

            chunk = client.create_chunk(
                upload_id=upload["id"],
                chunk_index=chunk_index,
                content=chunk_content[:5000],
                metadata={"pages": relevant_pages, "source": upload["filename"]},
            )
            chunk_index += 1

            n_qa = qa_per_chunk

            # Attach relevant page images for vision context (max 2)
            content_blocks: list[dict] = []
            for pidx in relevant_pages[:2]:
                if pidx in page_images:
                    content_blocks.append({
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": page_images[pidx],
                        },
                    })

            prompt_text = QA_GENERATION_PROMPT.format(
                n=n_qa,
                context_section=context_section,
                content=chunk_content[:3000],
                format_instructions=format_instructions,
            )
            content_blocks.append({"type": "text", "text": prompt_text})

            has_images = any(pidx in page_images for pidx in relevant_pages[:2])
            qa_pairs = _call_llm(llm, content_blocks, use_vision=has_images)

            for qa in qa_pairs:
                all_items.append({
                    "chunk_id": chunk["id"],
                    "question": qa["question"],
                    "answer": qa["answer"],
                })

    # Process image-only pages (diagrams, charts, etc.)
    for page_data in image_only_pages:
        chunk = client.create_chunk(
            upload_id=upload["id"],
            chunk_index=chunk_index,
            content=f"[Image-only page {page_data['page']}]",
            metadata={"page": page_data["page"], "source": upload["filename"]},
        )
        chunk_index += 1

        content_blocks = [
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "data": page_data["image_base64"],
                },
            },
        ]
        prompt_text = QA_GENERATION_PROMPT.format(
            n=qa_per_chunk,
            context_section=context_section,
            content="[See image above]",
            format_instructions=format_instructions,
        )
        content_blocks.append({"type": "text", "text": prompt_text})

        qa_pairs = _call_llm(llm, content_blocks, use_vision=True)
        for qa in qa_pairs:
            all_items.append({
                "chunk_id": chunk["id"],
                "question": qa["question"],
                "answer": qa["answer"],
            })

    return all_items


def _build_format_instructions(context: dict) -> str:
    """Build format instruction string from project context."""
    parts = []
    if context.get("response_format"):
        parts.append(f"- Answers should follow this format: {context['response_format']}")
    if context.get("self_awareness"):
        parts.append(f"\n- When relevant, the answer should reflect this identity: {context['self_awareness']}")
    return "".join(parts)


def _process_text(
    client: APIClient,
    llm: LLMClient,
    upload: dict,
    local_path: str,
    context_section: str,
    context: dict,
    qa_per_chunk: int = DEFAULT_QA_PER_CHUNK,
) -> list[dict]:
    """Process a text file: chunk and generate Q&A pairs."""
    with open(local_path, "r", errors="replace") as f:
        text = f.read()

    chunks = chunk_text(text)
    all_items = []

    for i, chunk_text_content in enumerate(chunks):
        if not chunk_text_content.strip():
            continue

        # Store chunk
        chunk = client.create_chunk(
            upload_id=upload["id"],
            chunk_index=i,
            content=chunk_text_content[:5000],
            metadata={"chunk_index": i, "source": upload["filename"]},
        )

        prompt_text = QA_GENERATION_PROMPT.format(
            n=qa_per_chunk,
            context_section=context_section,
            content=chunk_text_content,
            format_instructions=_build_format_instructions(context),
        )

        content_blocks = [{"type": "text", "text": prompt_text}]
        qa_pairs = _call_llm(llm, content_blocks, use_vision=False)

        for qa in qa_pairs:
            all_items.append({
                "chunk_id": chunk["id"],
                "question": qa["question"],
                "answer": qa["answer"],
            })

    return all_items


def _call_llm(llm: LLMClient, content_blocks: list[dict], use_vision: bool = False) -> list[dict]:
    """Call LLM to generate Q&A pairs. Returns parsed list of {question, answer} dicts."""
    try:
        response = llm.generate(
            system=SYSTEM_PROMPT,
            content_blocks=content_blocks,
            max_tokens=4096,
            use_vision=use_vision,
        )

        response_text = response.text

        # Extract JSON from response (handle markdown code blocks)
        if "```json" in response_text:
            response_text = response_text.split("```json")[1].split("```")[0]
        elif "```" in response_text:
            response_text = response_text.split("```")[1].split("```")[0]

        qa_pairs = json.loads(response_text.strip())

        # Validate structure
        validated = []
        for qa in qa_pairs:
            if isinstance(qa, dict) and "question" in qa and "answer" in qa:
                validated.append({
                    "question": str(qa["question"]).strip(),
                    "answer": str(qa["answer"]).strip(),
                })
        return validated

    except (json.JSONDecodeError, IndexError, KeyError) as e:
        print(f"[harness] Failed to parse LLM response: {e}")
        return []
    except Exception as e:
        print(f"[harness] LLM API error: {e}")
        return []
