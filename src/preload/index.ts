import { contextBridge, ipcRenderer } from "electron"

export interface SessionApi {
  getSessions: () => Promise<unknown[]>
  refresh: () => Promise<void>
  focusSession: (name: string) => Promise<void>
  onSessionsUpdate: (callback: (sessions: unknown[]) => void) => void
}

const api: SessionApi = {
  getSessions: () => ipcRenderer.invoke("get-sessions"),
  refresh: () => ipcRenderer.invoke("refresh"),
  focusSession: (name: string) => ipcRenderer.invoke("focus-session", name),
  onSessionsUpdate: (callback: (sessions: unknown[]) => void) => {
    ipcRenderer.on("sessions-update", (_event, sessions: unknown[]) =>
      callback(sessions)
    )
  }
}

contextBridge.exposeInMainWorld("api", api)

declare global {
  interface Window {
    api: SessionApi
  }
}
