"""PDF and text file extraction utilities."""

import base64
import fitz  # PyMuPDF


def extract_pdf_pages(pdf_path: str) -> list[dict]:
    """Extract text and page images from a PDF.

    Returns list of dicts:
        {"page": int, "text": str, "image_base64": str}
    """
    doc = fitz.open(pdf_path)
    pages = []

    for i, page in enumerate(doc):
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
    if len(text) <= chunk_size:
        return [text] if text.strip() else []

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

        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)

        start = end - overlap if end < len(text) else end

    return chunks
