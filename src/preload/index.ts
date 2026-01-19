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

export interface DisplaySettings {
  cardSize?: "regular" | "compact"
  sortBy?: "recent" | "status" | "name" | "context"
  hiddenSessions?: string[]
  showHidden?: boolean
  opacity?: number // 0.3 to 1.0
}

export interface WindowSettings {
  x?: number
  y?: number
  width?: number
  height?: number
}

export interface UsageSettings {
  usagePercent?: number
  resetDayOfWeek?: number // 0=Sunday, 4=Thursday
  resetHour?: number
  resetMinute?: number
}

export interface AppSettings {
  llm: LlmSettings
  session: SessionSettings
  display?: DisplaySettings
  window?: WindowSettings
  usage?: UsageSettings
}

export interface ProviderPreset {
  name: string
  provider: "anthropic" | "openai" | "ollama" | "lmstudio"
  baseUrl: string
  requiresApiKey: boolean
  defaultModel: string
  availableModels: string[]
}

export interface TestConnectionResult {
  success: boolean
  message: string
  model?: string
  responseTime?: number
}

export interface SettingsApi {
  getSettings: () => Promise<AppSettings>
  saveSettings: (settings: AppSettings) => Promise<AppSettings>
  updateLlmSettings: (llmSettings: LlmSettings) => Promise<AppSettings>
  getProviderPresets: () => Promise<Record<string, ProviderPreset>>
  testLlmConnection: (llmSettings: LlmSettings) => Promise<TestConnectionResult>
  setWindowOpacity: (opacity: number) => Promise<void>
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
  testLlmConnection: (llmSettings: LlmSettings) =>
    ipcRenderer.invoke("test-llm-connection", llmSettings),
  setWindowOpacity: (opacity: number) =>
    ipcRenderer.invoke("set-window-opacity", opacity),
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
