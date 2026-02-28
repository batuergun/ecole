"""Lightweight LLM provider abstraction supporting Anthropic and Mistral."""

import base64
import json
from dataclasses import dataclass

import anthropic
from mistralai import Mistral


ANTHROPIC_MODEL = "claude-sonnet-4-6"
MISTRAL_TEXT_MODEL = "mistral-large-latest"
MISTRAL_VISION_MODEL = "pixtral-large-latest"


@dataclass
class LLMResponse:
    text: str


class LLMClient:
    """Unified interface over Anthropic and Mistral APIs."""

    def __init__(self, provider: str, client):
        self.provider = provider
        self._client = client

    def generate(
        self,
        system: str,
        content_blocks: list[dict],
        max_tokens: int = 4096,
        use_vision: bool = False,
    ) -> LLMResponse:
        if self.provider == "anthropic":
            return self._generate_anthropic(system, content_blocks, max_tokens)
        return self._generate_mistral(system, content_blocks, max_tokens, use_vision)

    def _generate_anthropic(
        self, system: str, content_blocks: list[dict], max_tokens: int
    ) -> LLMResponse:
        response = self._client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": content_blocks}],
        )
        return LLMResponse(text=response.content[0].text)

    def _generate_mistral(
        self,
        system: str,
        content_blocks: list[dict],
        max_tokens: int,
        use_vision: bool,
    ) -> LLMResponse:
        model = MISTRAL_VISION_MODEL if use_vision else MISTRAL_TEXT_MODEL

        # Convert Anthropic-format content blocks to Mistral format
        mistral_content = []
        for block in content_blocks:
            if block["type"] == "text":
                mistral_content.append({"type": "text", "text": block["text"]})
            elif block["type"] == "image":
                source = block["source"]
                data_uri = f"data:{source['media_type']};base64,{source['data']}"
                mistral_content.append({
                    "type": "image_url",
                    "image_url": {"url": data_uri},
                })

        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": mistral_content},
        ]

        response = self._client.chat.complete(
            model=model,
            messages=messages,
            max_tokens=max_tokens,
        )
        return LLMResponse(text=response.choices[0].message.content)


def create_llm_client(provider: str, keys: dict) -> LLMClient:
    """Factory: create an LLMClient for the given provider."""
    if provider == "mistral":
        api_key = keys.get("mistral_key", "")
        if not api_key:
            raise ValueError("No Mistral API key configured. Set it in Settings.")
        client = Mistral(api_key=api_key)
        return LLMClient(provider="mistral", client=client)

    # Default: anthropic
    api_key = keys.get("anthropic_key", "")
    if not api_key:
        raise ValueError(
            "No Anthropic API key configured. Set it in Settings or ANTHROPIC_API_KEY env var."
        )
    client = anthropic.Anthropic(api_key=api_key)
    return LLMClient(provider="anthropic", client=client)
