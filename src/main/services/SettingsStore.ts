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
  Schema.Literal("anthropic"),
  Schema.Literal("openai"),
  Schema.Literal("ollama"),
  Schema.Literal("lmstudio")
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
  pollIntervalMs: Schema.Number
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
  window: Schema.optional(WindowSettingsSchema)
})

export type LlmSettings = typeof LlmSettingsSchema.Type
export type SessionSettings = typeof SessionSettingsSchema.Type
export type WindowSettings = typeof WindowSettingsSchema.Type
export type AppSettings = typeof AppSettingsSchema.Type

// ============================================================================
// Default Settings
// ============================================================================

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  provider: "lmstudio",
  model: "qwen/qwen3-30b-a3b-2507",
  baseUrl: "http://localhost:1234/v1"
}

export const DEFAULT_SESSION_SETTINGS: SessionSettings = {
  sessionPattern: "^atrim",
  maxSessionAgeHours: 24,
  pollIntervalMs: 30000
}

export const DEFAULT_SETTINGS: AppSettings = {
  llm: DEFAULT_LLM_SETTINGS,
  session: DEFAULT_SESSION_SETTINGS
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
      // Merge with defaults to ensure all fields exist
      return {
        llm: { ...DEFAULT_LLM_SETTINGS, ...decoded.value.llm },
        session: { ...DEFAULT_SESSION_SETTINGS, ...decoded.value.session },
        window: decoded.value.window
      }
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
