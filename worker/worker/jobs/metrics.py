"""Deterministic evaluation metrics: semantic similarity and ROUGE-L."""

from __future__ import annotations

import re

_st_model = None


def strip_think_tags(text: str) -> str:
    """Strip <think>...</think> blocks and incomplete trailing <think> blocks from text."""
    # Remove complete <think>...</think> blocks (including across newlines)
    text = re.sub(r"<think>[\s\S]*?</think>", "", text)
    # Remove incomplete trailing <think> block (opened but never closed)
    text = re.sub(r"<think>[\s\S]*$", "", text)
    return text.strip()


def _get_st_model():
    """Lazy-load and cache the sentence-transformers model."""
    global _st_model
    if _st_model is None:
        from sentence_transformers import SentenceTransformer

        _st_model = SentenceTransformer("all-MiniLM-L6-v2")
    return _st_model


def semantic_similarity(text_a: str, text_b: str) -> float:
    """Compute cosine similarity between two texts using sentence embeddings."""
    model = _get_st_model()
    embeddings = model.encode([text_a, text_b], normalize_embeddings=True)
    score = float(embeddings[0] @ embeddings[1])
    return max(0.0, min(1.0, score))


def rouge_l_score(prediction: str, reference: str) -> float:
    """Compute ROUGE-L F-measure between prediction and reference."""
    from rouge_score import rouge_scorer

    scorer = rouge_scorer.RougeScorer(["rougeL"], use_stemmer=True)
    scores = scorer.score(reference, prediction)
    return float(scores["rougeL"].fmeasure)


def compute_metrics(answer: str, expected: str) -> dict[str, float | None]:
    """Compute all deterministic metrics for a single answer/expected pair.

    Returns None for any metric that fails so the benchmark can continue.
    """
    result: dict[str, float | None] = {
        "semantic_similarity": None,
        "rouge_l": None,
    }

    try:
        result["semantic_similarity"] = semantic_similarity(answer, expected)
    except Exception as e:
        print(f"[metrics] semantic_similarity error: {e}")

    try:
        result["rouge_l"] = rouge_l_score(answer, expected)
    except Exception as e:
        print(f"[metrics] rouge_l error: {e}")

    return result
