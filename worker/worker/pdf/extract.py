"""PDF and text file extraction utilities."""

import base64
import fitz  # PyMuPDF

# Suppress noisy MuPDF warnings (e.g. "No common ancestor in structure tree")
fitz.TOOLS.mupdf_display_errors(False)


def extract_pdf_pages(pdf_path: str) -> list[dict]:
    """Extract text and page images from a PDF.

    Returns list of dicts:
        {"page": int, "text": str, "image_base64": str}
    """
    doc = fitz.open(pdf_path)
    pages = []

    for i, page in enumerate(doc):
        try:
            text = page.get_text()

            # Render page as image for VLM
            pix = page.get_pixmap(dpi=150)
            img_bytes = pix.tobytes("png")
            img_b64 = base64.b64encode(img_bytes).decode("utf-8")

            pages.append({
                "page": i,
                "text": text.strip(),
                "image_base64": img_b64,
            })
        except Exception as e:
            print(f"[pdf] Skipping page {i}: {e}")

    doc.close()
    return pages


def chunk_text(text: str, chunk_size: int = 3000, overlap: int = 300) -> list[str]:
    """Split text into overlapping chunks by character count.

    Args:
        text: The input text to chunk.
        chunk_size: Target size of each chunk in characters (~750 tokens).
        overlap: Number of characters to overlap between chunks.

    Returns:
        List of text chunks.
    """
    return [c for c, _, _ in _chunk_impl(text, chunk_size, overlap)]


def chunk_text_with_positions(
    text: str, chunk_size: int = 3000, overlap: int = 300
) -> list[tuple[str, int, int]]:
    """Split text into overlapping chunks, returning positions.

    Returns:
        List of (chunk_text, start_offset, end_offset) tuples.
    """
    return _chunk_impl(text, chunk_size, overlap)


def _chunk_impl(
    text: str, chunk_size: int, overlap: int
) -> list[tuple[str, int, int]]:
    """Core chunking logic. Returns (text, start, end) tuples."""
    if len(text) <= chunk_size:
        return [(text, 0, len(text))] if text.strip() else []

    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size

        # Try to break at a paragraph or sentence boundary
        if end < len(text):
            # Look for paragraph break
            para_break = text.rfind("\n\n", start + chunk_size // 2, end)
            if para_break != -1:
                end = para_break + 2
            else:
                # Look for sentence break
                for sep in (". ", ".\n", "! ", "? "):
                    sent_break = text.rfind(sep, start + chunk_size // 2, end)
                    if sent_break != -1:
                        end = sent_break + len(sep)
                        break

        actual_end = min(end, len(text))
        chunk = text[start:actual_end].strip()
        if chunk:
            chunks.append((chunk, start, actual_end))

        start = end - overlap if end < len(text) else end

    return chunks
