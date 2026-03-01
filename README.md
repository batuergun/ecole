<div align="center">

# Ecole

**Fine-tune language models with your own data end-to-end.**

Upload your documents, and Ecole handles the rest: dataset generation, model training, and evaluation.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

</div>

## What is Ecole?

Ecole takes your documents (PDFs, text files) and uses them to fine-tune a language model that understands your specific domain. The entire pipeline is automated:

1. **Upload** your files
2. **Generate** a training dataset from your documents
3. **Train** a fine-tuned model
4. **Evaluate** how much better the fine-tuned model is vs. the base model
5. **Push** your model to HuggingFace Hub

## Prerequisites

- [Docker](https://www.docker.com/products/docker-desktop/) installed and running
- A [HuggingFace API key](https://huggingface.co/settings/tokens) (for model training)
- An [Anthropic API key](https://console.anthropic.com/) (for dataset generation)
- A [Mistral API key](https://console.mistral.ai/) (for training)

## Getting Started

### 1. Clone the repo

```bash
git clone https://github.com/batuhanergun/ecole.git
cd ecole
```

### 2. Add your API keys

Create a `.env` file in the project root:

```env
ANTHROPIC_API_KEY=your-anthropic-key-here
MISTRAL_API_KEY=your-mistral-key-here
HF_TOKEN=your-huggingface-token-here
```

### 3. Start the app

```bash
make up
```

That's it! Open [http://localhost:5173](http://localhost:5173) in your browser.

## Usage

1. Create a new project
2. Upload your documents (PDF or text)
3. Click "Generate Dataset" — Ecole reads your documents and creates Q&A training pairs
4. Review the generated dataset (edit or remove pairs if needed)
5. Start training
6. View benchmark results comparing your fine-tuned model to the base model

## GPU Support

If you have an NVIDIA GPU and want to train locally instead of using HuggingFace cloud:

```bash
make up-gpu
```

## Stopping the App

```bash
make down
```

## License

MIT
