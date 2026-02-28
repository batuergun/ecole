"""PDF extraction utilities using PyMuPDF."""


def extract_pages(pdf_path: str) -> list[dict]:
    """Extract text and images from each page of a PDF.

    Returns a list of dicts with 'page', 'text', and optionally 'image_base64' keys.
    """
    # TODO: Phase 2 implementation
    # import fitz
    # doc = fitz.open(pdf_path)
    # pages = []
    # for i, page in enumerate(doc):
    #     text = page.get_text()
    #     pix = page.get_pixmap()
    #     img_bytes = pix.tobytes("png")
    #     pages.append({"page": i, "text": text, "image_bytes": img_bytes})
    # return pages
    return []
