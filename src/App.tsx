import { useEffect, useRef, useState } from "react";
import { BrainCircuit, Camera, Expand, Keyboard, Mic, MicOff, MonitorCog, PanelRight, ScrollText, Send } from "lucide-react";
import { ArtifactPanel } from "./components/ArtifactPanel";
import { RickyFace } from "./components/RickyFace";
import { newEntry, RickyRealtimeClient, type MouthShape, type RickyConnectionState, type RickyMood, type TranscriptEntry } from "./lib/realtime";
import type { RickyArtifact } from "./vite-env";

type RickyMode = "display" | "computer";

type CameraDevice = { index: number; label: string; kind: string };

export default function App() {
  const [connectionState, setConnectionState] = useState<RickyConnectionState>("idle");
  const [mood, setMood] = useState<RickyMood>("idle");
  const [mode, setMode] = useState<RickyMode>("display");
  const [artifact, setArtifact] = useState<RickyArtifact | null>(null);
  const [artifactVisible, setArtifactVisible] = useState(true);
  const [artifactFullscreen, setArtifactFullscreen] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [showTypeInput, setShowTypeInput] = useState(false);
  const [showCameraPicker, setShowCameraPicker] = useState(false);
  const [cameraDevices, setCameraDevices] = useState<CameraDevice[]>([]);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraAnalyze, setCameraAnalyze] = useState(true);
  const [mouthShape, setMouthShape] = useState<MouthShape>({ open: 0, width: 0.18, round: 0, teeth: 0 });
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([
    newEntry("system", "Ricky is ready. Connect voice, then talk naturally."),
  ]);
  const [status, setStatus] = useState("Idle");
  const [textPrompt, setTextPrompt] = useState("");
  const clientRef = useRef<RickyRealtimeClient | null>(null);

  const isConnected = connectionState === "connected";

  useEffect(() => {
    if (!window.ricky?.onShowCameraPicker) return;
    return window.ricky.onShowCameraPicker((payload) => {
      if (typeof payload?.analyze === "boolean") setCameraAnalyze(payload.analyze);
      void openCameraPicker();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect() {
    const client = new RickyRealtimeClient({
      onConnectionState: setConnectionState,
      onMood: setMood,
      onMouthShape: setMouthShape,
      onTranscript: (entry) => setTranscript((items) => [entry, ...items].slice(0, 80)),
      onArtifact: (nextArtifact) => {
        setArtifact(nextArtifact);
        setArtifactVisible(true);
        if (nextArtifact.fullscreen) setArtifactFullscreen(true);
      },
      onMode: (nextMode) => {
        setMode(nextMode);
        if (nextMode === "computer") {
          setArtifactVisible(false);
          setArtifactFullscreen(false);
          setShowLog(false);
          setShowTypeInput(false);
        } else {
          setArtifactVisible(true);
        }
      },
      onStatus: (message) => {
        setStatus(message);
        setTranscript((items) => [newEntry("system", message), ...items].slice(0, 80));
      },
      onThumbnailReady: playThumbnailReadySound,
    });
    clientRef.current = client;
    await client.connect();
  }

  function disconnect() {
    clientRef.current?.disconnect();
    clientRef.current = null;
    setStatus("Disconnected");
  }

  async function switchMode(nextMode: RickyMode) {
    setMode(nextMode);
    const result = await window.ricky.executeTool({ name: "set_mode", arguments: { mode: nextMode } });
    if (result.artifact) setArtifact(result.artifact);
    if (nextMode === "computer") {
      setArtifactVisible(false);
      setArtifactFullscreen(false);
      setShowLog(false);
      setShowTypeInput(false);
    } else {
      setArtifactVisible(true);
    }
    setTranscript((items) => [newEntry("system", `Mode switched to ${nextMode}.`), ...items].slice(0, 80));
  }

  async function openCameraPicker() {
    setShowCameraPicker(true);
    setCameraError(null);
    setCameraDevices([]);
    const result = await window.ricky.executeTool({ name: "camera_list_devices", arguments: {} });
    if (!result.ok) {
      setCameraError(result.error || "Could not list cameras");
      return;
    }
    const devices = (result.devices as CameraDevice[]) || [];
    setCameraDevices(devices);
    if (devices.length === 0) setCameraError("No cameras found. Plug one in or enable iPhone Continuity Camera.");
  }

  async function captureFromDevice(device: CameraDevice) {
    setCameraBusy(true);
    setCameraError(null);
    try {
      const result = await window.ricky.executeTool({
        name: "camera_capture",
        arguments: {
          device: device.label,
          saveToPhotos: true,
          analyze: cameraAnalyze,
          analysisPrompt: "Describe what's in this photo in 2-3 sentences. Be specific and concise.",
        },
      });
      if (result.artifact) {
        setArtifact(result.artifact);
        setArtifactVisible(true);
      }
      if (!result.ok) setCameraError(result.error || "Capture failed");
      setShowCameraPicker(false);
    } finally {
      setCameraBusy(false);
    }
  }

  function sendTextPrompt() {
    const trimmed = textPrompt.trim();
    if (!trimmed) return;
    clientRef.current?.sendText(trimmed);
    setTextPrompt("");
    setShowTypeInput(false);
  }

  if (mode === "computer") {
    return (
      <main className="app-shell app-shell-mini">
        <section className="mini-companion" aria-label="Ricky computer use mini mode">
          <RickyFace mood={mood} mouthShape={mouthShape} />
          <button
            className="mini-restore-button"
            onClick={() => void switchMode("display")}
            aria-label="Return to full Ricky window"
            title="Return to full Ricky window"
          >
            <Expand size={14} />
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <div className="window-drag-strip" aria-hidden="true" />
      <div className="window-drag-left-zone" aria-hidden="true" />
      <section className="companion-window">
        <button
          className={showLog ? "log-toggle active" : "log-toggle"}
          onClick={() => setShowLog((value) => !value)}
          aria-label="Toggle live log"
          title="Toggle live log"
        >
          <ScrollText size={14} />
        </button>
        <section className="face-stage">
          <RickyFace mood={mood} mouthShape={mouthShape} />
        </section>

        <footer className="bottom-console">
          {showTypeInput ? (
            <section className="prompt-box">
              <input
                value={textPrompt}
                onChange={(event) => setTextPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") sendTextPrompt();
                }}
                autoFocus
                placeholder="Type to Ricky..."
              />
              <button onClick={sendTextPrompt} aria-label="Send typed prompt" title="Send typed prompt">
                <Send size={15} />
              </button>
            </section>
          ) : null}

          <section className="control-strip">
            <button
              className={isConnected ? "simple-button active" : "simple-button"}
              onClick={isConnected ? disconnect : connect}
              disabled={connectionState === "connecting"}
              aria-label={isConnected ? "Disconnect voice" : "Connect voice"}
              title={isConnected ? "Disconnect voice" : "Connect voice"}
            >
              {isConnected ? <MicOff size={16} /> : <Mic size={16} />}
            </button>
            <button
              className={showTypeInput ? "simple-button active" : "simple-button"}
              onClick={() => setShowTypeInput((value) => !value)}
              aria-label="Type to Ricky"
              title="Type to Ricky"
            >
              <Keyboard size={16} />
            </button>
            <button
              className={mode === "display" ? "simple-button active" : "simple-button"}
              onClick={() => void switchMode("display")}
              aria-label="Display mode"
              title="Display mode"
            >
              <PanelRight size={16} />
            </button>
            <button
              className="simple-button danger"
              onClick={() => void switchMode("computer")}
              aria-label="Computer use mode"
              title="Computer use mode"
            >
              <MonitorCog size={16} />
            </button>
            <button
              className={showCameraPicker ? "simple-button active" : "simple-button"}
              onClick={() => void openCameraPicker()}
              aria-label="Take a photo"
              title="Take a photo"
            >
              <Camera size={16} />
            </button>
            <button
              className={artifactVisible ? "simple-button active" : "simple-button"}
              onClick={() => setArtifactVisible((value) => !value)}
              aria-label="Toggle artifacts"
              title="Toggle artifacts"
            >
              <BrainCircuit size={16} />
            </button>
          </section>
        </footer>

        {showLog ? (
          <section className="transcript">
            <div className="section-title">
              <span>Live Log</span>
              <small>{transcript.length} events</small>
            </div>
            <div className="transcript-list">
              {transcript.map((entry) => (
                <article className={`entry entry-${entry.role}`} key={entry.id}>
                  <div>
                    <strong>{entry.role === "ricky" ? "Ricky" : entry.role}</strong>
                    <time>{entry.at}</time>
                  </div>
                  <p>{entry.text}</p>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {showCameraPicker ? (
          <section className="camera-picker">
            <div className="section-title">
              <span>Camera</span>
              <button className="camera-close" onClick={() => setShowCameraPicker(false)} aria-label="Close camera picker">
                ×
              </button>
            </div>
            {cameraError ? <p className="camera-error">{cameraError}</p> : null}
            {cameraDevices.length === 0 && !cameraError ? <p className="camera-status">Locating cameras…</p> : null}
            <div className="camera-device-list">
              {cameraDevices.map((device) => (
                <button
                  key={`${device.index}-${device.label}`}
                  className="camera-device"
                  disabled={cameraBusy}
                  onClick={() => void captureFromDevice(device)}
                >
                  <span className="camera-device-label">{device.label}</span>
                  <small className={`camera-device-kind kind-${device.kind}`}>{device.kind}</small>
                </button>
              ))}
            </div>
            <label className="camera-analyze-toggle">
              <input type="checkbox" checked={cameraAnalyze} onChange={(e) => setCameraAnalyze(e.target.checked)} />
              <span>Analyze with vision AI</span>
            </label>
            {cameraBusy ? <p className="camera-status">Capturing…</p> : null}
          </section>
        ) : null}
      </section>

      <ArtifactPanel
        artifact={artifact}
        visible={artifactVisible}
        fullscreen={artifactFullscreen}
        onToggleVisible={() => setArtifactVisible((value) => !value)}
        onToggleFullscreen={() => setArtifactFullscreen((value) => !value)}
      />
    </main>
  );
}

function playThumbnailReadySound() {
  try {
    const AudioContextClass = window.AudioContext;
    const audio = new AudioContextClass();
    const gain = audio.createGain();
    const osc = audio.createOscillator();

    osc.type = "sine";
    osc.frequency.setValueAtTime(880, audio.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1320, audio.currentTime + 0.08);
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.035, audio.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.13);

    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.14);
    window.setTimeout(() => void audio.close(), 220);
  } catch {
    // Audio cues are optional; ignore browsers that block short sounds.
  }
}
