export type MouthShape = {
  open: number;
  width: number;
  round: number;
  teeth: number;
};

export function silentMouthShape(): MouthShape {
  return { open: 0, width: 0.18, round: 0, teeth: 0 };
}

export function smoothMouthShape(current: MouthShape, target: MouthShape, amount: number): MouthShape {
  return {
    open: lerp(current.open, target.open, amount),
    width: lerp(current.width, target.width, amount),
    round: lerp(current.round, target.round, amount),
    teeth: lerp(current.teeth, target.teeth, amount),
  };
}

export function getSpeechBands(frequencies: Uint8Array): { low: number; mid: number; high: number } {
  const low = averageRange(frequencies, 2, 14) / 255;
  const mid = averageRange(frequencies, 14, 48) / 255;
  const high = averageRange(frequencies, 48, 110) / 255;
  return { low: clamp01(low * 2.2), mid: clamp01(mid * 2.1), high: clamp01(high * 2.8) };
}

/**
 * Drives a MouthShape from an output-audio analyser at animation-frame rate.
 * Shared by the Realtime meter (WebRTC stream) and the local Kokoro playback
 * meter, so lip sync behaves identically in both engines. Returns a stop fn.
 */
export function startVisemeLoop(analyser: AnalyserNode, onShape: (shape: MouthShape) => void): () => void {
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.72;

  const samples = new Uint8Array(analyser.fftSize);
  const frequencies = new Uint8Array(analyser.frequencyBinCount);
  let smoothed = silentMouthShape();
  let frame = 0;

  const tick = () => {
    analyser.getByteTimeDomainData(samples);
    analyser.getByteFrequencyData(frequencies);
    let total = 0;
    for (const sample of samples) {
      const centered = (sample - 128) / 128;
      total += centered * centered;
    }
    const rms = Math.sqrt(total / samples.length);
    const energy = clamp01(rms * 10.5);
    const bands = getSpeechBands(frequencies);

    // Simple realtime viseme approximation: low energy rounds the mouth,
    // mid energy opens it, high energy stretches it for consonants/ee sounds.
    const target: MouthShape = {
      open: clamp01(energy * 0.75 + bands.mid * 0.45 - bands.high * 0.16),
      width: clamp01(0.28 + bands.mid * 0.55 + bands.high * 0.74 - bands.low * 0.28),
      round: clamp01(0.08 + bands.low * 0.95 + energy * 0.1 - bands.high * 0.42),
      teeth: clamp01(bands.high * 1.4 + bands.mid * 0.25 - bands.low * 0.35),
    };

    smoothed = smoothMouthShape(smoothed, target, 0.36);
    onShape(smoothed);
    frame = window.requestAnimationFrame(tick);
  };
  tick();

  return () => {
    if (frame) window.cancelAnimationFrame(frame);
    onShape(silentMouthShape());
  };
}

function averageRange(values: Uint8Array, start: number, end: number): number {
  const cappedEnd = Math.min(end, values.length);
  if (start >= cappedEnd) return 0;
  let total = 0;
  for (let index = start; index < cappedEnd; index += 1) {
    total += values[index];
  }
  return total / (cappedEnd - start);
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
