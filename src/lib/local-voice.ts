import { KokoroTTS } from "kokoro-js";
import { MicVAD } from "@ricky0123/vad-web";
import { env, pipeline } from "@huggingface/transformers";
import type { RickyArtifact, RickyChatMessage, RickyToolCall, RickyToolResult, RickyToolSpec } from "../vite-env";
import {
  newEntry,
  parseToolArguments,
  sanitizeToolResult,
  type RealtimeCallbacks,
  type RickyMood,
  type TranscriptEntry,
} from "./realtime";
import { startVisemeLoop } from "./viseme";
import type { VoiceProvider } from "./voice-provider";

/**
 * Fully local voice provider for this machine (Apple M3 Pro, arm64).
 *
 * Pipeline — no audio byte ever leaves the laptop:
 *   mic → Silero VAD (always on) → Whisper ONNX (WebGPU) → chat LLM (tools,
 *   via llm:chat IPC) → Kokoro-82M (WebGPU) → AudioContext → viseme meter.
 *
 * Duplex behavior: the VAD keeps listening while Jarvis speaks, so confirmed
 * user speech interrupts playback and any in-flight LLM round (barge-in),
 * matching the Realtime session's interrupt_response semantics. Echo
 * cancellation on the mic keeps Jarvis from hearing itself.
 *
 * Optimization notes (M3 Pro): WebGPU with wasm/q8 fallback, models stay
 * loaded across disconnects (module-level cache), TTS is sentence-pipelined
 * so the first sentence plays while later ones are still synthesizing, and
 * first-run model downloads land in the browser cache for offline use.
 */

// Tuning knobs — single place to retune the local stack for this machine.
const KOKORO_MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const KOKORO_VOICE = "am_michael"; // "confident man's voice" per Jarvis's instructions
// The ".en" model beats multilingual base on English and can't wander into
// other languages; VAD utterances here are always English by design.
const WHISPER_MODEL_ID = "onnx-community/whisper-base.en";
const WHISPER_LANGUAGE = "en";
const MAX_TOOL_ROUNDS = 4;
const HISTORY_LIMIT = 24; // messages sent to the LLM per round
const TTS_CHUNK_CHARS = 220; // max characters per Kokoro call (sentence-ish)

// Stock phrases Whisper hallucinates on near-silence (well-known artifacts).
const WHISPER_HALLUCINATIONS = /^(thank you( for watching)?|thanks for watching|you|bye|mm-hmm|subtitles? by [a-z0-9 .]+)[.!?. ]*$/i;

type AsrPipeline = (
  audio: Float32Array,
  options: Record<string, unknown>,
) => Promise<{ text: string } | Array<{ text: string }> | string>;

type LocalEngines = {
  device: "webgpu" | "wasm";
  tts: KokoroTTS;
  asr: AsrPipeline;
};

// Shared across connect/disconnect cycles so reconnecting is instant.
let enginesPromise: Promise<LocalEngines> | null = null;

export class LocalVoiceProvider implements VoiceProvider {
  private callbacks: RealtimeCallbacks;
  private vad: MicVAD | null = null;
  private audioContext: AudioContext | null = null;
  private stopVisemes: (() => void) | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private playbackTail: Promise<void> = Promise.resolve();
  private toolSpecs: RickyToolSpec[] = [];
  private history: RickyChatMessage[] = [];
  private mood: RickyMood = "idle";
  private toolRunning = false;
  /** Bumped on every interrupt/new turn; stale async chains check it and bail. */
  private turnSession = 0;
  private speakSession = 0;

  constructor(callbacks: RealtimeCallbacks) {
    this.callbacks = callbacks;
  }

  async connect(): Promise<void> {
    if (this.vad) return;
    this.callbacks.onConnectionState("connecting");
    this.callbacks.onMood("thinking");
    this.callbacks.onStatus("Loading local voice models (first run downloads them once).");

    try {
      const engines = await loadEngines(this.callbacks.onStatus);
      this.toolSpecs = await window.ricky.getToolSpecs();

      this.audioContext = new AudioContext({ latencyHint: "interactive" });
      await this.audioContext.resume();

      // Duplex loop: VAD owns the mic and keeps running while Jarvis speaks.
      // Interrupts fire on confirmed speech (onSpeechRealStart), not on the
      // raw trigger, so a cough or echo blip never cuts Jarvis off mid-word.
      this.vad = await MicVAD.new({
        model: "v5",
        baseAssetPath: new URL("vendor/vad/", document.baseURI).href,
        onnxWASMBasePath: new URL("vendor/ort/", document.baseURI).href,
        positiveSpeechThreshold: 0.5,
        negativeSpeechThreshold: 0.35,
        preSpeechPadMs: 600, // keep the first phoneme: clipped starts garble short commands
        redemptionMs: 1000, // ride out mid-sentence pauses instead of shipping fragments
        minSpeechMs: 250,
        onSpeechStart: () => {
          if (this.mood !== "speaking") this.setMood("listening");
        },
        onSpeechRealStart: () => {
          if (this.mood === "speaking" || this.mood === "thinking" || this.mood === "working") {
            this.interrupt();
          }
        },
        onSpeechEnd: (audio) => void this.handleUtterance(audio),
        startOnLoad: true,
      });
      void engines; // engines stay cached in loadEngines; referenced for the error path

      this.callbacks.onConnectionState("connected");
      this.playBlip();
      this.setMood("idle");
      this.callbacks.onStatus(
        `Jarvis is live on local voice (${engines.device === "webgpu" ? "WebGPU" : "WASM"}). Talk naturally — interrupt anytime.`,
      );
    } catch (error) {
      this.callbacks.onConnectionState("error");
      this.callbacks.onMood("error");
      this.callbacks.onStatus(error instanceof Error ? error.message : String(error));
      this.disconnect();
    }
  }

  disconnect(): void {
    this.interrupt();
    try {
      void this.vad?.destroy();
    } catch {
      // VAD teardown is best-effort; the mic track stops with destroy().
    }
    this.vad = null;
    this.stopVisemes?.();
    this.stopVisemes = null;
    void this.audioContext?.close();
    this.audioContext = null;
    this.history = [];
    this.toolRunning = false;
    this.callbacks.onConnectionState("idle");
    this.callbacks.onMood("idle");
    this.callbacks.onMouthShape({ open: 0, width: 0.18, round: 0, teeth: 0 });
  }

  sendText(text: string): void {
    // Text works with or without the mic connected (text-only session).
    this.interrupt();
    this.callbacks.onTranscript(newEntry("user", text));
    this.pushHistory({ role: "user", content: text });
    this.setMood("thinking");
    // Text-only sessions skip connect(), which is where tool specs load —
    // fetch them on demand, or every tool call gets rejected as unavailable.
    const ready =
      this.toolSpecs.length > 0
        ? Promise.resolve()
        : window.ricky
            .getToolSpecs()
            .then((specs) => {
              this.toolSpecs = specs;
            })
            .catch(() => undefined); // chat still works without tools
    void ready.then(() => this.chatLoop()).catch((error: unknown) => {
      console.log(`[local-voice] text turn failed: ${error instanceof Error ? error.message : String(error)}`);
      this.callbacks.onStatus(error instanceof Error ? error.message : String(error));
      this.setMood("error");
    });
  }

  // ── ears ────────────────────────────────────────────────

  private async handleUtterance(audio: Float32Array): Promise<void> {
    const session = ++this.turnSession;
    this.speakSession++; // a new utterance invalidates anything still queued
    this.setMood("thinking");

    let text = "";
    const whisperStart = performance.now();
    try {
      const engines = await loadEngines(this.callbacks.onStatus);
      // Short VAD utterances take Whisper's short-form path; forcing the 30s
      // chunk window on a 2s clip is a known source of empty transcriptions.
      const options: Record<string, unknown> = {};
      if (audio.length / 16000 > 25) {
        options.chunk_length_s = 30;
        options.stride_length_s = 5;
      }
      if (!WHISPER_MODEL_ID.endsWith(".en")) {
        options.language = WHISPER_LANGUAGE;
        options.task = "transcribe";
      }
      const result = await engines.asr(audio, options);
      text = (Array.isArray(result) ? result[0]?.text : typeof result === "string" ? result : result?.text) || "";
    } catch (error) {
      this.callbacks.onStatus(`Local transcription failed: ${error instanceof Error ? error.message : String(error)}`);
      this.setMood("idle");
      return;
    }
    const whisperMs = Math.round(performance.now() - whisperStart);
    console.log(`[local-voice] whisper ${whisperMs}ms · heard "${text.trim()}" (${(audio.length / 16000).toFixed(1)}s audio)`);
    this.callbacks.onStatus(`Heard you · whisper ${whisperMs}ms`);
    if (session !== this.turnSession) return;

    text = text.trim();
    if (!text || WHISPER_HALLUCINATIONS.test(text)) {
      // Whisper emits stock phrases on near-silence; sending those to the LLM
      // is exactly what produced "your speech got jumbled" replies.
      this.callbacks.onStatus("Didn't catch that — say it again?");
      this.setMood("idle");
      return;
    }

    this.callbacks.onTranscript(newEntry("user", text));
    this.pushHistory({ role: "user", content: text });
    try {
      await this.chatLoop();
    } catch (error) {
      console.log(`[local-voice] voice turn failed: ${error instanceof Error ? error.message : String(error)}`);
      this.callbacks.onStatus(error instanceof Error ? error.message : String(error));
      this.setMood("error");
    }
  }

  // ── brain + hands ───────────────────────────────────────

  private async chatLoop(): Promise<void> {
    const session = this.turnSession;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      if (session !== this.turnSession) return;

      let reply: Awaited<ReturnType<typeof window.ricky.llmChat>>;
      const llmStart = performance.now();
      try {
        reply = await window.ricky.llmChat({ messages: this.trimmedHistory() });
      } catch (error) {
        if (session === this.turnSession) {
          this.callbacks.onStatus(error instanceof Error ? error.message : String(error));
          this.setMood("error");
        }
        return;
      }
      const llmMs = Math.round(performance.now() - llmStart);
      console.log(`[local-voice] llm ${llmMs}ms (round ${round + 1}, ${(reply.tool_calls?.length || 0)} tool calls)`);
      if (session !== this.turnSession) return;

      const toolCalls = reply.tool_calls || [];
      if (toolCalls.length === 0) {
        const spoken = (reply.content || "").trim();
        if (spoken) this.callbacks.onTranscript(newEntry("ricky", spoken));
        this.pushHistory({ role: "assistant", content: reply.content || "" });
        await this.speak(spoken);
        return;
      }

      this.pushHistory({
        role: "assistant",
        content: reply.content || "",
        tool_calls: toolCalls,
      });
      const shouldRespond = await this.executeToolCalls(toolCalls);
      if (session !== this.turnSession) {
        console.log("[local-voice] turn superseded during tools — stopping");
        return;
      }
      if (!shouldRespond) {
        // Emotion tour only: the face cycles through moods with no reply.
        console.log("[local-voice] emotion tour only — no reply round");
        if (!this.toolRunning) this.setMood("idle");
        return;
      }
    }

    this.callbacks.onStatus("Stopped after too many tool rounds.");
    this.setMood("idle");
  }

  /** Mirrors RickyRealtimeClient.executeFunctionCalls, appending to chat history. */
  private async executeToolCalls(toolCalls: NonNullable<Awaited<ReturnType<typeof window.ricky.llmChat>>["tool_calls"]>): Promise<boolean> {
    this.toolRunning = true;
    this.setMood("working");
    let shouldRespond = false;
    let emotionTour = false;

    for (const call of toolCalls) {
      const callId = call.id;
      const name = call.function?.name;
      if (!callId || !name) continue;

      const parsedArgs = parseToolArguments(call.function?.arguments || "{}");
      if (!this.toolSpecs.some((tool) => tool.name === name)) {
        this.pushToolResult(callId, { ok: false, error: `Tool is not available: ${name}` });
        shouldRespond = true;
        continue;
      }

      this.callbacks.onTranscript(newEntry("tool", `Running ${name}`));
      if (name === "image_generate") {
        this.callbacks.onArtifact({
          title: "Generating Image",
          kind: "imageLoading",
          content: typeof parsedArgs.prompt === "string" ? parsedArgs.prompt : "Jarvis is generating an image.",
        });
      }
      if (name === "thumbnail_generate" || name === "thumbnail_edit") {
        const loadingResult = await window.ricky.executeTool({
          name: "thumbnail_loading_prepare",
          arguments: {
            ...parsedArgs,
            mode: name === "thumbnail_edit" ? "edit" : "generate",
          },
        } satisfies RickyToolCall);
        if (typeof loadingResult.runId === "string") parsedArgs.runId = loadingResult.runId;
        if (typeof loadingResult.targetId === "string") parsedArgs.targetId = loadingResult.targetId;
        if (loadingResult.artifact) this.callbacks.onArtifact(loadingResult.artifact);
      }
      const result = await window.ricky
        .executeTool({ name, arguments: parsedArgs } satisfies RickyToolCall)
        .then((value) => {
          console.log(`[local-voice] tool ${name} done · ok=${value.ok}${value.error ? ` · ${value.error}` : ""}`);
          return value;
        })
        .catch((error: unknown) => {
          console.log(`[local-voice] tool ${name} THREW: ${error instanceof Error ? error.message : String(error)}`);
          throw error;
        });
      if (result.mode === "display" || result.mode === "computer") {
        this.callbacks.onMode(result.mode);
      }
      if (typeof result.mood === "string") {
        this.setMood(result.mood as RickyMood);
      }
      if (result.artifact) this.callbacks.onArtifact(result.artifact);
      if (result.thumbnailReady === true) this.callbacks.onThumbnailReady();
      if (result.emotionTour === true) {
        emotionTour = true;
        this.callbacks.onEmotionTour?.();
      }
      if (result.silent !== true) shouldRespond = true;
      this.pushToolResult(callId, result);
    }

    this.toolRunning = false;
    // Only the emotion tour skips the reply round — its mood cycle would be
    // cut short by speak(). Silent tools like set_mood still need the model's
    // follow-up turn to actually answer the user.
    return shouldRespond || !emotionTour;
  }

  private pushToolResult(callId: string, result: RickyToolResult): void {
    this.pushHistory({
      role: "tool",
      tool_call_id: callId,
      content: JSON.stringify(sanitizeToolResult(result)),
    });
  }

  private pushHistory(message: RickyChatMessage): void {
    this.history.push(message);
    if (this.history.length > 200) this.history = this.history.slice(-100);
  }

  // ── mouth ───────────────────────────────────────────────

  /** Speaks text through Kokoro, pipelined sentence-by-sentence. */
  private async speak(text: string): Promise<void> {
    const chunks = chunkForSpeech(text);
    if (chunks.length === 0 || !this.audioContext) {
      // Text-only session (typed chat before voice connect): the reply stays
      // on screen — no synthesis without a playback context.
      this.setMood("idle");
      return;
    }

    const session = ++this.speakSession;
    this.setMood("speaking");
    let playedAny = false;
    const speakStart = performance.now();

    for (const chunk of chunks) {
      if (session !== this.speakSession) return;

      let samples: Float32Array;
      let sampleRate: number;
      try {
        const engines = await loadEngines(this.callbacks.onStatus);
        const chunkStart = performance.now();
        const audio = await engines.tts.generate(chunk, { voice: KOKORO_VOICE });
        if (!playedAny) {
          console.log(`[local-voice] tts first chunk ${Math.round(performance.now() - chunkStart)}ms (${chunk.length} chars)`);
          this.callbacks.onStatus(`Speaking · first voice ${Math.round(performance.now() - speakStart)}ms`);
        }
        samples = audio.audio;
        sampleRate = audio.sampling_rate;
      } catch (error) {
        this.callbacks.onStatus(`Local speech failed: ${error instanceof Error ? error.message : String(error)}`);
        this.setMood("idle");
        return;
      }
      if (session !== this.speakSession) return;

      playedAny = true;
      // Chain onto the playback tail: chunk N+1 synthesizes while chunk N plays.
      this.playbackTail = this.playbackTail.then(() => this.playChunk(session, samples, sampleRate));
    }

    if (playedAny) {
      await this.playbackTail.catch((error) =>
        console.log(`[local-voice] playback chain error: ${error instanceof Error ? error.message : String(error)}`),
      );
      if (session === this.speakSession && !this.toolRunning) this.setMood("idle");
    }
  }

  private playChunk(session: number, samples: Float32Array, sampleRate: number): Promise<void> {
    return new Promise((resolve) => {
      if (session !== this.speakSession || !this.audioContext) {
        console.log(
          `[local-voice] play skipped (session ${session}/${this.speakSession}, ctx ${this.audioContext ? "yes" : "no"})`,
        );
        resolve();
        return;
      }
      const context = this.audioContext;
      const buffer = context.createBuffer(1, samples.length, sampleRate);
      buffer.copyToChannel(new Float32Array(samples), 0);

      const source = context.createBufferSource();
      source.buffer = buffer;
      const analyser = context.createAnalyser();
      source.connect(analyser).connect(context.destination);

      this.stopVisemes?.();
      this.stopVisemes = startVisemeLoop(analyser, this.callbacks.onMouthShape);

      this.currentSource = source;
      console.log(
        `[local-voice] playing ${(samples.length / sampleRate).toFixed(1)}s @${sampleRate}Hz (ctx ${context.sampleRate}Hz, ${context.state})`,
      );
      source.onended = () => {
        console.log("[local-voice] chunk ended");
        if (this.currentSource === source) this.currentSource = null;
        resolve();
      };
      source.start();
    });
  }

  /** Connected cue — also proves the audio output path end-to-end. */
  private playBlip(): void {
    const context = this.audioContext;
    if (!context || context.state !== "running") return;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.05, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
    osc.connect(gain).connect(context.destination);
    osc.start();
    osc.stop(context.currentTime + 0.2);
  }

  // ── duplex control ──────────────────────────────────────

  /** Full-duplex interrupt: stop audio, cancel the turn, hand the floor back. */
  private interrupt(): void {
    this.turnSession++;
    this.speakSession++;
    try {
      this.currentSource?.stop();
    } catch {
      // Already stopped.
    }
    this.currentSource = null;
    // Drain the tail so a later speak() never chains behind a dead chunk.
    this.playbackTail = this.playbackTail.then(() => undefined).catch(() => undefined);
  }

  private setMood(mood: RickyMood): void {
    this.mood = mood;
    this.callbacks.onMood(mood);
  }

  /** History window for the next request, kept valid for tool exchanges. */
  private trimmedHistory() {
    let cut = Math.max(0, this.history.length - HISTORY_LIMIT);
    // Never open the window on orphaned tool output — its parent assistant
    // tool_call message must ride along or the API rejects the request.
    while (cut < this.history.length && this.history[cut].role === "tool") cut += 1;
    return this.history.slice(cut);
  }
}

// ── engine loading (module-level cache) ──────────────────

/** Preloads models in the background so Connect feels instant later. */
export function warmupLocalVoice(): void {
  void loadEngines(null).catch(() => {
    // Warm failures surface later at connect() with a status message.
  });
}

async function loadEngines(onStatus: ((message: string) => void) | null): Promise<LocalEngines> {
  if (!enginesPromise) {
    enginesPromise = buildEngines(onStatus).catch((error) => {
      enginesPromise = null; // allow a retry after a failed first load
      throw error;
    });
  }
  return enginesPromise;
}

async function buildEngines(onStatus: ((message: string) => void) | null): Promise<LocalEngines> {
  // Serve ORT wasm + the Silero model from the app itself (scripts/copy-voice-assets),
  // so after the one-time model download the stack runs fully offline.
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  const wasmConfig = env.backends.onnx.wasm;
  if (wasmConfig) {
    // BaseURI-relative so it resolves on the vite dev server AND from the
    // packaged dist/index.html (file://) without hardcoding an origin.
    wasmConfig.wasmPaths = new URL("vendor/ort/", document.baseURI).href;
  }

  const device = await detectWebGPU();
  onStatus?.(`Loading local voice models (${device === "webgpu" ? "WebGPU" : "WASM"})…`);

  const progress = (file: string) => (data: { status?: string; progress?: number; file?: string }) => {
    if (data.status === "progress" && data.file) {
      const percent = typeof data.progress === "number" ? ` ${Math.round(data.progress)}%` : "";
      onStatus?.(`Downloading ${data.file}${percent} — first run only.`);
      void file;
    }
  };

  // Kokoro: WebGPU wants fp32 per kokoro-js guidance; wasm wants q8.
  const kokoroDtype = (dtype: "fp32" | "q8" | "fp16" | "q4" | "q4f16") => dtype;
  const ttsAttempts = device === "webgpu" ? [kokoroDtype("fp32"), kokoroDtype("q8")] : [kokoroDtype("q8")];
  const tts = await withFallbacks(
    `Kokoro (${KOKORO_MODEL_ID})`,
    ttsAttempts.map((dtype) => () => {
      onStatus?.(`Loading Kokoro voice model (${dtype})…`);
      return KokoroTTS.from_pretrained(KOKORO_MODEL_ID, { dtype, device });
    }),
  );

  // Whisper on WebGPU: the q8 decoder degenerates into repetition loops (18s
  // of garbage for 3s of speech — see [local-voice] log, 2026-08-20), so use
  // the whisper-web demo combo (fp32 encoder + q4 decoder), full fp32 as the
  // safe fallback, and q8 only on wasm.
  const asr = await withFallbacks(
    `Whisper (${WHISPER_MODEL_ID})`,
    [
      () => {
        onStatus?.("Loading Whisper speech model…");
        return pipeline("automatic-speech-recognition", WHISPER_MODEL_ID, {
          device,
          dtype:
            device === "webgpu"
              ? { encoder_model: "fp32", decoder_model_merged: "q4" }
              : "q8",
          progress_callback: progress("whisper"),
        });
      },
      () =>
        pipeline("automatic-speech-recognition", WHISPER_MODEL_ID, {
          device,
          dtype: { encoder_model: "fp32", decoder_model_merged: "fp32" },
          progress_callback: progress("whisper"),
        }),
      () =>
        pipeline("automatic-speech-recognition", WHISPER_MODEL_ID, {
          device,
          dtype: "q8",
          progress_callback: progress("whisper"),
        }),
    ],
  );

  // First synthesis pays a one-time WebGPU/wasm graph build (~3s on M3 Pro).
  // Pay it at load time, not in front of the first spoken reply.
  try {
    await tts.generate("Ready.", { voice: KOKORO_VOICE });
  } catch {
    // Warm synthesis is best-effort; real calls surface their own errors.
  }

  return { device, tts, asr: asr as unknown as AsrPipeline };
}

async function detectWebGPU(): Promise<"webgpu" | "wasm"> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
    if (gpu && (await gpu.requestAdapter()) !== null) return "webgpu";
  } catch {
    // Fall through to wasm.
  }
  return "wasm";
}

async function withFallbacks<T>(label: string, attempts: Array<() => Promise<T>>): Promise<T> {
  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`${label} failed to load: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

// ── speech text prep ─────────────────────────────────────

/** Strips what shouldn't be spoken (code fences, markdown, links). */
function speechableText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#*_>~|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Splits into sentence-ish chunks under TTS_CHUNK_CHARS so playback starts fast. */
function chunkForSpeech(text: string): string[] {
  const clean = speechableText(text);
  if (!clean) return [];

  const sentences = clean.match(/[^.!?…]+[.!?…]+(\s|$)|[^.!?…]+$/g) || [clean];
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    if (current && (current + " " + trimmed).length > TTS_CHUNK_CHARS) {
      chunks.push(current);
      current = trimmed;
    } else {
      current = current ? `${current} ${trimmed}` : trimmed;
    }
  }
  if (current) chunks.push(current);

  // A single over-long chunk (no sentence punctuation) still needs splitting.
  return chunks.flatMap((chunk) =>
    chunk.length <= TTS_CHUNK_CHARS * 1.5 ? [chunk] : splitHard(chunk, TTS_CHUNK_CHARS),
  );
}

function splitHard(text: string, limit: number): string[] {
  const words = text.split(" ");
  const parts: string[] = [];
  let current = "";
  for (const word of words) {
    if (current && (current + " " + word).length > limit) {
      parts.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) parts.push(current);
  return parts;
}

// Keep the transcript entry type referenced for local consumers.
export type { TranscriptEntry, RickyArtifact };
