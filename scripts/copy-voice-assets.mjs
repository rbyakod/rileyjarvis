// Copies the local-voice runtime assets into public/vendor so the app serves
// them itself instead of fetching ONNX Runtime wasm and the Silero VAD model
// from a CDN. Run by postinstall, dev, and build — safe to re-run anytime.
import { cpSync, mkdirSync, readdirSync, rmSync, statSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vendor = join(root, "public", "vendor");

function copyFiltered(sourceDir, targetDir, keep) {
  mkdirSync(targetDir, { recursive: true });
  let bytes = 0;
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile() || !keep(entry.name)) continue;
    cpSync(join(sourceDir, entry.name), join(targetDir, entry.name));
    bytes += statSync(join(targetDir, entry.name)).size;
  }
  return bytes;
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

rmSync(vendor, { recursive: true, force: true });

// ONNX Runtime Web: wasm binaries + their ESM glue (jsep = WebGPU build).
const ortDir = join(root, "node_modules", "onnxruntime-web", "dist");
if (!existsSync(ortDir)) throw new Error("onnxruntime-web/dist not found — run npm install first");
const ortBytes = copyFiltered(ortDir, join(vendor, "ort"), (name) =>
  /^ort[\w.-]*\.(wasm|mjs)$/i.test(name) && !name.includes("bundle"),
);

// Silero VAD: the onnx model and the audio-worklet bundle.
const vadDir = join(root, "node_modules", "@ricky0123", "vad-web", "dist");
if (!existsSync(vadDir)) throw new Error("@ricky0123/vad-web/dist not found — run npm install first");
const vadBytes = copyFiltered(vadDir, join(vendor, "vad"), (name) =>
  /^(silero_vad.*\.onnx|vad\.worklet\.bundle\.min\.js)$/.test(name),
);

console.log(`[voice-assets] ort → public/vendor/ort (${mb(ortBytes)})`);
console.log(`[voice-assets] vad → public/vendor/vad (${mb(vadBytes)})`);
