const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ricky", {
  createRealtimeToken: () => ipcRenderer.invoke("realtime:create-token"),
  executeTool: (toolCall) => ipcRenderer.invoke("tools:execute", toolCall),
  getToolSpecs: () => ipcRenderer.invoke("tools:list"),
  onCursorMove: (cb) => {
    const listener = (_event, point) => cb(point);
    ipcRenderer.on("cursor:pos", listener);
    return () => ipcRenderer.removeListener("cursor:pos", listener);
  },
});
