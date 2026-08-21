const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ricky", {
  createRealtimeToken: () => ipcRenderer.invoke("realtime:create-token"),
  llmChat: (payload) => ipcRenderer.invoke("llm:chat", payload),
  executeTool: (toolCall) => ipcRenderer.invoke("tools:execute", toolCall),
  getToolSpecs: () => ipcRenderer.invoke("tools:list"),
  onCursorMove: (cb) => {
    const listener = (_event, point) => cb(point);
    ipcRenderer.on("cursor:pos", listener);
    return () => ipcRenderer.removeListener("cursor:pos", listener);
  },
  onShowCameraPicker: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on("camera:show-picker", listener);
    return () => ipcRenderer.removeListener("camera:show-picker", listener);
  },
});
