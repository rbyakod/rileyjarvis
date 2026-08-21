import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * ONNX Runtime Web dynamically import()s its wasm glue (.mjs) from the URL we
 * point wasmPaths at (public/vendor/ort). In dev, requests for /public files
 * that arrive as module imports fail Vite's import analysis; serve them raw.
 */
function vendorOrtModules(): Plugin {
  return {
    name: "vendor-ort-modules",
    resolveId(source) {
      if (source.includes("/vendor/ort/") && source.endsWith(".mjs")) return source;
      return null;
    },
    load(id) {
      const marker = "/vendor/ort/";
      const index = id.indexOf(marker);
      if (index === -1 || !id.endsWith(".mjs")) return null;
      const relative = id.slice(index + marker.length);
      const file = path.join(process.cwd(), "public", "vendor", "ort", relative);
      return readFileSync(file, "utf-8");
    },
  };
}

export default defineConfig({
  plugins: [react(), vendorOrtModules()],
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
});
