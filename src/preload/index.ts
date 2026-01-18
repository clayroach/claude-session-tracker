import { contextBridge, ipcRenderer } from "electron"

// ============================================================================
// Session API
// ============================================================================

export interface SessionApi {
  getSessions: () => Promise<unknown[]>
  refresh: () => Promise<void>
  focusSession: (name: string) => Promise<void>
  openEditor: (path: string) => Promise<void>
  onSessionsUpdate: (callback: (sessions: unknown[]) => void) => void
}

// ============================================================================
// Settings API
// ============================================================================

export interface LlmSettings {
  provider: "none" | "anthropic" | "openai" | "ollama" | "lmstudio"
  model: string
  apiKey?: string
  baseUrl?: string
}

export interface SessionSettings {
  sessionPattern: string
  maxSessionAgeHours: number
  pollIntervalMs: number
  editorCommand?: string
}

export interface WindowSettings {
  x?: number
  y?: number
  width?: number
  height?: number
}

export interface AppSettings {
  llm: LlmSettings
  session: SessionSettings
  window?: WindowSettings
}

export interface ProviderPreset {
  name: string
  provider: "anthropic" | "openai" | "ollama" | "lmstudio"
  baseUrl: string
  requiresApiKey: boolean
  defaultModel: string
  availableModels: string[]
}

export interface SettingsApi {
  getSettings: () => Promise<AppSettings>
  saveSettings: (settings: AppSettings) => Promise<AppSettings>
  updateLlmSettings: (llmSettings: LlmSettings) => Promise<AppSettings>
  getProviderPresets: () => Promise<Record<string, ProviderPreset>>
  onSettingsUpdate: (callback: (settings: AppSettings) => void) => void
}

// ============================================================================
// Combined API
// ============================================================================

export interface Api extends SessionApi, SettingsApi {}

const api: Api = {
  // Session API
  getSessions: () => ipcRenderer.invoke("get-sessions"),
  refresh: () => ipcRenderer.invoke("refresh"),
  focusSession: (name: string) => ipcRenderer.invoke("focus-session", name),
  openEditor: (path: string) => ipcRenderer.invoke("open-editor", path),
  onSessionsUpdate: (callback: (sessions: unknown[]) => void) => {
    ipcRenderer.on("sessions-update", (_event, sessions: unknown[]) =>
      callback(sessions)
    )
  },

  // Settings API
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke("save-settings", settings),
  updateLlmSettings: (llmSettings: LlmSettings) =>
    ipcRenderer.invoke("update-llm-settings", llmSettings),
  getProviderPresets: () => ipcRenderer.invoke("get-provider-presets"),
  onSettingsUpdate: (callback: (settings: AppSettings) => void) => {
    ipcRenderer.on("settings-update", (_event, settings: AppSettings) =>
      callback(settings)
    )
  }
}

contextBridge.exposeInMainWorld("api", api)

declare global {
  interface Window {
    api: Api
  }
}
