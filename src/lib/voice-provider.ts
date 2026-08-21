import type { RealtimeCallbacks } from "./realtime";

/**
 * The seam between the app and whichever voice engine is active.
 * `RickyRealtimeClient` (OpenAI Realtime WebRTC) and `LocalVoiceProvider`
 * (Silero VAD + Whisper + chat LLM + Kokoro, all on-device) both implement it,
 * so App.tsx wires callbacks exactly once for either engine.
 */
export type VoiceCallbacks = RealtimeCallbacks;

export interface VoiceProvider {
  connect(): Promise<void>;
  disconnect(): void;
  sendText(text: string): void;
}
