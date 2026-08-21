# RileyJarvis

RileyJarvis is a local Electron desktop AI companion with realtime voice, a visual artifact panel, image generation, web search, notes, and opt-in macOS computer control.

It is built with Electron, React, Vite, TypeScript, and OpenAI APIs — with a fully local voice mode that keeps every audio byte on your machine.

## Features

- **Local voice mode (default):** full-duplex conversation powered entirely on-device — Silero VAD for turn detection, Whisper (ONNX, WebGPU) for speech-to-text, and Kokoro-82M for text-to-speech. Works offline after the first model download, with barge-in interruption while Jarvis speaks. Toggle it in the control strip (CPU icon = local, cloud icon = OpenAI Realtime).
- Realtime speech-to-speech conversation with OpenAI Realtime (fallback engine).
- Animated companion face with listening, thinking, speaking, and working states.
- Artifact panel for markdown, menus, notes, Mermaid diagrams, generated images, records, and progress.
- YouTube thumbnail board with persistent numbered generations and image edits.
- Optional Exa-powered web search.
- Local notes and records stored at runtime under `data/`.
- Optional computer-use mode for opening apps, clicking, typing, scrolling, screenshots, and UI inspection on macOS.

## Requirements

- macOS
- Node.js 20+
- npm
- An OpenAI API key with Realtime and image generation access
- Optional: an Exa API key for web search

## Quick Start

```bash
git clone https://github.com/rileybrown/rileyjarvis.git
cd rileyjarvis
npm install
cp .env.example .env.local
npm run dev
```

Edit `.env.local` before starting voice features:

```bash
OPENAI_API_KEY=your_openai_api_key_here
EXA_API_KEY=your_exa_api_key_here
```

`OPENAI_API_KEY` is required. `EXA_API_KEY` is optional; web search will show a setup message when it is missing.

Optional overrides for the local voice mode's brain (it calls a chat-completions endpoint through the main process):

```bash
RICKY_LLM_MODEL=gpt-4o-mini          # any chat model with tool calling
RICKY_LLM_BASE_URL=http://localhost:11434/v1   # e.g. Ollama, for 100% offline
```

## Local Voice Mode

Voice defaults to running on your machine: Silero VAD → Whisper → chat LLM → Kokoro, via `kokoro-js`, `@huggingface/transformers`, and `@ricky0123/vad-web` (all ONNX Runtime Web, WebGPU-accelerated on Apple Silicon with a WASM fallback). Details and the migration story live in `local-voice-plan.html`.

- First connect downloads the models once (~250–450 MB, cached afterwards; runtime assets under `public/vendor/` are copied locally by `npm run voice:assets`, which also runs on install/dev/build).
- Models stay loaded across sessions, so reconnecting is instant.
- Only the LLM brain still needs the network — swap in any OpenAI-compatible local server with `RICKY_LLM_BASE_URL` to go fully offline.
- Tuning knobs (voice, models, chunking, VAD thresholds) sit at the top of `src/lib/local-voice.ts`.

## macOS Permissions

RileyJarvis runs locally. Depending on the features you use, macOS may ask for:

- Microphone permission for voice conversation.
- Accessibility permission for computer-control tools.
- Screen Recording permission for screenshots and screen inspection.

Computer-control tools are blocked until the app is in computer-use mode.

## Development

```bash
npm run dev
```

This starts Vite on `127.0.0.1:5173` and launches Electron.

Other useful commands:

```bash
npm run typecheck
npm run build
npm start
```

## Runtime Data

The app creates a local `data/` directory for notes, records, generated images, and thumbnail-board state. That directory is intentionally ignored by Git.

Do not commit:

- `.env.local`
- Anything under `data/`
- `dist/`
- `node_modules/`

## Security Notes

- API keys are loaded only from local environment files.
- `.env.local` and all `.env.*` files are ignored except `.env.example`.
- Generated images and local database files are ignored.
- Risky computer-control actions should require explicit confirmation.
- Typing and pressing Enter in computer-use mode are intentionally allowed without extra confirmation because they are core voice-control actions.

Before publishing a fork, run:

```bash
npm run typecheck
npm run build
git status --short
```

Then verify that no local secrets or runtime data are staged.

## License

MIT
