import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("liftMonitor", {
  getState: () => ipcRenderer.invoke("lift-monitor:get"),
  addLift: (payload) => ipcRenderer.invoke("lift-monitor:add", payload),
  removeLift: (id) => ipcRenderer.invoke("lift-monitor:remove", id),
  checkNow: () => ipcRenderer.invoke("lift-monitor:check-now"),
  setIntervalMinutes: (minutes) => ipcRenderer.invoke("lift-monitor:set-interval", minutes),
  onUpdate: (listener) => {
    const handler = (_event, data) => listener(data);
    ipcRenderer.on("lift-monitor:update", handler);
    return () => ipcRenderer.removeListener("lift-monitor:update", handler);
  }
});
