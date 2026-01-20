import { FileSystem, Path } from "@effect/platform"
import { Effect, Schema, Option, Data } from "effect"
import { app } from "electron"
import type { LlmProvider, LlmConfig } from "./LlmService.js"

// ============================================================================
// Errors
// ============================================================================

export class SettingsError extends Data.TaggedError("SettingsError")<{
  readonly operation: string
  readonly message: string
}> {}

// ============================================================================
// Settings Schema
// ============================================================================

const LlmProviderSchema = Schema.Union(
  Schema.Literal("none"),
  Schema.Literal("anthropic"),
  Schema.Literal("openai"),
  Schema.Literal("ollama"),
  Schema.Literal("lmstudio")
)

const StatusSourceSchema = Schema.Union(
  Schema.Literal("tmux"),
  Schema.Literal("jsonl"),
  Schema.Literal("hybrid")
)

const LlmSettingsSchema = Schema.Struct({
  provider: LlmProviderSchema,
  model: Schema.String,
  apiKey: Schema.optional(Schema.String),
  baseUrl: Schema.optional(Schema.String)
})

const SessionSettingsSchema = Schema.Struct({
  sessionPattern: Schema.String,
  maxSessionAgeHours: Schema.Number,
  pollIntervalMs: Schema.Number,
  editorCommand: Schema.optional(Schema.String),
  statusSource: Schema.optional(StatusSourceSchema)
})

const DisplaySettingsSchema = Schema.Struct({
  cardSize: Schema.optional(Schema.Union(
    Schema.Literal("regular"),
    Schema.Literal("compact")
  )),
  sortBy: Schema.optional(Schema.Union(
    Schema.Literal("recent"),
    Schema.Literal("status"),
    Schema.Literal("name"),
    Schema.Literal("context")
  )),
  hiddenSessions: Schema.optional(Schema.Array(Schema.String)),
  showHidden: Schema.optional(Schema.Boolean),
  opacity: Schema.optional(Schema.Number)
})

// Usage history entry for tracking daily usage
const UsageHistoryEntrySchema = Schema.Struct({
  date: Schema.String, // YYYY-MM-DD
  utilization: Schema.Number, // 7-day utilization at time of recording
  timestamp: Schema.Number // Unix timestamp when recorded
})

const UsageHistorySchema = Schema.Struct({
  entries: Schema.Array(UsageHistoryEntrySchema),
  lastRecordedDate: Schema.NullOr(Schema.String)
})

const WindowSettingsSchema = Schema.Struct({
  x: Schema.optional(Schema.Number),
  y: Schema.optional(Schema.Number),
  width: Schema.optional(Schema.Number),
  height: Schema.optional(Schema.Number)
})

const AppSettingsSchema = Schema.Struct({
  llm: LlmSettingsSchema,
  session: SessionSettingsSchema,
  display: Schema.optional(DisplaySettingsSchema),
  window: Schema.optional(WindowSettingsSchema),
  usageHistory: Schema.optional(UsageHistorySchema)
})

export type LlmSettings = typeof LlmSettingsSchema.Type
export type SessionSettings = typeof SessionSettingsSchema.Type
export type StatusSource = typeof StatusSourceSchema.Type
export type DisplaySettings = typeof DisplaySettingsSchema.Type
export type WindowSettings = typeof WindowSettingsSchema.Type

// Define mutable types for usage history (Schema types are readonly)
export interface UsageHistoryEntry {
  date: string
  utilization: number
  timestamp: number
}

export interface UsageHistory {
  entries: UsageHistoryEntry[]
  lastRecordedDate: string | null
}

export type AppSettings = {
  llm: LlmSettings
  session: SessionSettings
  display?: DisplaySettings
  window?: WindowSettings
  usageHistory?: UsageHistory
}

// ============================================================================
// Default Settings
// ============================================================================

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  provider: "none", // Disabled by default to reduce CPU usage
  model: ""
}

export const DEFAULT_SESSION_SETTINGS: SessionSettings = {
  sessionPattern: ".*",
  maxSessionAgeHours: 48,
  pollIntervalMs: 60000, // 60 seconds (reduced LLM load)
  editorCommand: "code",
  statusSource: "hybrid" // hybrid: pane for status, JSONL for metadata on change
}

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  cardSize: "regular",
  sortBy: "recent",
  opacity: 1.0
}

export const DEFAULT_USAGE_HISTORY: UsageHistory = {
  entries: [],
  lastRecordedDate: null
}

export const DEFAULT_SETTINGS: AppSettings = {
  llm: DEFAULT_LLM_SETTINGS,
  session: DEFAULT_SESSION_SETTINGS,
  display: DEFAULT_DISPLAY_SETTINGS,
  usageHistory: DEFAULT_USAGE_HISTORY
}

// ============================================================================
// Provider Presets
// ============================================================================

export interface ProviderPreset {
  readonly name: string
  readonly provider: LlmProvider
  readonly baseUrl: string
  readonly requiresApiKey: boolean
  readonly defaultModel: string
  readonly availableModels: readonly string[]
}

export const PROVIDER_PRESETS: Record<LlmProvider, ProviderPreset> = {
  none: {
    name: "None (Disabled)",
    provider: "none",
    baseUrl: "",
    requiresApiKey: false,
    defaultModel: "",
    availableModels: []
  },
  anthropic: {
    name: "Claude (Anthropic)",
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com",
    requiresApiKey: true,
    defaultModel: "claude-sonnet-4-20250514",
    availableModels: [
      "claude-sonnet-4-20250514",
      "claude-opus-4-5-20251101",
      "claude-3-5-haiku-20241022"
    ]
  },
  openai: {
    name: "OpenAI",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    requiresApiKey: true,
    defaultModel: "gpt-4o",
    availableModels: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"]
  },
  ollama: {
    name: "Ollama (Local)",
    provider: "ollama",
    baseUrl: "http://localhost:11434/v1",
    requiresApiKey: false,
    defaultModel: "llama3.2",
    availableModels: ["llama3.2", "mistral", "codellama", "qwen2.5"]
  },
  lmstudio: {
    name: "LM Studio (Local)",
    provider: "lmstudio",
    baseUrl: "http://localhost:1234/v1",
    requiresApiKey: false,
    defaultModel: "qwen/qwen3-30b-a3b-2507",
    availableModels: []
  }
}

// ============================================================================
// Settings File Path
// ============================================================================

const getSettingsPath = Effect.gen(function* () {
  const pathService = yield* Path.Path

  // Use Electron's userData path for persistent storage
  const userDataPath = app.getPath("userData")
  return pathService.join(userDataPath, "settings.json")
})

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Deep clone to convert readonly Schema types to mutable types.
 */
const toMutableSettings = (decoded: typeof AppSettingsSchema.Type): AppSettings => {
  const history = decoded.usageHistory
  const result: AppSettings = {
    llm: { ...DEFAULT_LLM_SETTINGS, ...decoded.llm },
    session: { ...DEFAULT_SESSION_SETTINGS, ...decoded.session },
    display: { ...DEFAULT_DISPLAY_SETTINGS, ...decoded.display },
    usageHistory: history ? {
      entries: history.entries.map(e => ({ ...e })),
      lastRecordedDate: history.lastRecordedDate
    } : DEFAULT_USAGE_HISTORY
  }

  // Only add window if it exists (exactOptionalPropertyTypes compatibility)
  if (decoded.window) {
    result.window = { ...decoded.window }
  }

  return result
}

// ============================================================================
// Service Implementation
// ============================================================================

/**
 * Load settings from disk, returning defaults if file doesn't exist.
 */
export const loadSettings = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const settingsPath = yield* getSettingsPath

  const exists = yield* fs.exists(settingsPath)
  if (!exists) {
    return DEFAULT_SETTINGS
  }

  const content = yield* fs.readFileString(settingsPath).pipe(
    Effect.catchAll(() => Effect.succeed(""))
  )

  if (content === "") {
    return DEFAULT_SETTINGS
  }

  try {
    const parsed = JSON.parse(content)
    const decoded = Schema.decodeUnknownOption(AppSettingsSchema)(parsed)

    if (Option.isSome(decoded)) {
      return toMutableSettings(decoded.value)
    }
  } catch {
    // Invalid JSON, return defaults
  }

  return DEFAULT_SETTINGS
})

/**
 * Save settings to disk.
 */
export const saveSettings = (settings: AppSettings) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const pathService = yield* Path.Path
    const settingsPath = yield* getSettingsPath

    // Ensure directory exists
    const dir = pathService.dirname(settingsPath)
    yield* fs.makeDirectory(dir, { recursive: true }).pipe(
      Effect.catchAll(() => Effect.void)
    )

    // Write settings
    const content = JSON.stringify(settings, null, 2)
    yield* fs.writeFileString(settingsPath, content).pipe(
      Effect.mapError((error) => new SettingsError({
        operation: "saveSettings",
        message: String(error)
      }))
    )

    return settings
  })

/**
 * Update LLM settings only.
 */
export const updateLlmSettings = (llmSettings: Partial<LlmSettings>) =>
  Effect.gen(function* () {
    const current = yield* loadSettings
    const updated: AppSettings = {
      ...current,
      llm: { ...current.llm, ...llmSettings }
    }
    return yield* saveSettings(updated)
  })

/**
 * Update session settings only.
 */
export const updateSessionSettings = (sessionSettings: Partial<SessionSettings>) =>
  Effect.gen(function* () {
    const current = yield* loadSettings
    const updated: AppSettings = {
      ...current,
      session: { ...current.session, ...sessionSettings }
    }
    return yield* saveSettings(updated)
  })

/**
 * Update window settings only.
 */
export const updateWindowSettings = (windowSettings: WindowSettings) =>
  Effect.gen(function* () {
    const current = yield* loadSettings
    const updated: AppSettings = {
      ...current,
      window: windowSettings
    }
    return yield* saveSettings(updated)
  })

/**
 * Convert LlmSettings to LlmConfig for use with LlmService.
 */
export const toLlmConfig = (settings: LlmSettings): LlmConfig => {
  const config: LlmConfig = {
    provider: settings.provider,
    model: settings.model
  }

  if (settings.apiKey !== undefined) {
    (config as { apiKey?: string }).apiKey = settings.apiKey
  }

  if (settings.baseUrl !== undefined) {
    (config as { baseUrl?: string }).baseUrl = settings.baseUrl
  }

  return config
}

/**
 * Reset settings to defaults.
 */
export const resetSettings = Effect.gen(function* () {
  return yield* saveSettings(DEFAULT_SETTINGS)
})

// ============================================================================
// Service Definition
// ============================================================================

export class SettingsStore extends Effect.Service<SettingsStore>()("SettingsStore", {
  accessors: true,
  effect: Effect.succeed({
    loadSettings,
    saveSettings,
    updateLlmSettings,
    updateSessionSettings,
    updateWindowSettings,
    resetSettings,
    toLlmConfig,
    PROVIDER_PRESETS,
    DEFAULT_SETTINGS
  })
}) {}
