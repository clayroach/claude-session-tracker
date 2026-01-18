import { Effect, Option, Duration, Data, Schema } from "effect"

// ============================================================================
// Errors
// ============================================================================

export class LlmError extends Data.TaggedError("LlmError")<{
  readonly operation: string
  readonly message: string
}> {}

// ============================================================================
// Configuration Types
// ============================================================================

export type LlmProvider = "none" | "anthropic" | "openai" | "ollama" | "lmstudio"

export interface LlmConfig {
  readonly provider: LlmProvider
  readonly model: string
  readonly apiKey?: string
  readonly baseUrl?: string
}

// ============================================================================
// Analysis Result Schema
// ============================================================================

const AnalysisResultSchema = Schema.Struct({
  state: Schema.Union(
    Schema.Literal("working"),
    Schema.Literal("permission"),
    Schema.Literal("waiting"),
    Schema.Literal("idle"),
    Schema.Literal("unknown")
  ),
  detail: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String)
})

export type AnalysisResult = typeof AnalysisResultSchema.Type

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: LlmConfig = {
  provider: "lmstudio",
  model: "qwen/qwen3-30b-a3b-2507",
  baseUrl: "http://localhost:1234/v1"
}

// ============================================================================
// Service Implementation
// ============================================================================

/**
 * System prompt for session analysis.
 */
const SYSTEM_PROMPT = `You analyze Claude Code session data to determine status and summarize activity.

Respond with ONLY a JSON object (no markdown, no thinking, no explanation):
{"state": "STATE", "detail": "DETAIL", "summary": "SUMMARY"}

STATE must be one of:
- "working" - Last entry shows Claude using tools or generating response (assistant with tool_use, no tool_result yet)
- "permission" - Claude used a tool that needs approval (Bash, Edit, Write, Task) and there's no tool_result following
- "waiting" - Claude's last message was text response (no pending tools), waiting for user input
- "idle" - No recent meaningful activity

DETAIL: Brief context (e.g., "processing", "approve: bash", "awaiting input")

SUMMARY: 1-2 sentence summary of what's happening or was last discussed. Focus on the actual task/topic.`

/**
 * Condense JSONL entries for LLM analysis.
 */
interface CondensedEntry {
  type: string
  timestamp?: string
  content?: string
  tool?: string
  toolInput?: string
  toolResult?: string
}

export const condenseEntries = (entries: ReadonlyArray<unknown>): CondensedEntry[] => {
  const condensed: CondensedEntry[] = []

  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue

    const e = entry as Record<string, unknown>
    const result: CondensedEntry = { type: String(e["type"] ?? "unknown") }

    if (e["timestamp"]) {
      result.timestamp = String(e["timestamp"])
    }

    if (e["type"] === "user" && e["message"]) {
      const msg = e["message"] as Record<string, unknown>
      const content = msg["content"]

      if (typeof content === "string") {
        result.content = content.slice(0, 200)
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (typeof block === "object" && block !== null) {
            const b = block as Record<string, unknown>
            if (b["type"] === "text" && typeof b["text"] === "string") {
              result.content = b["text"].slice(0, 200)
              break
            } else if (b["type"] === "tool_result" && typeof b["tool_use_id"] === "string") {
              result.toolResult = b["tool_use_id"]
            }
          }
        }
      }
    } else if (e["type"] === "assistant" && e["message"]) {
      const msg = e["message"] as Record<string, unknown>
      const content = msg["content"]

      if (Array.isArray(content)) {
        for (const block of content) {
          if (typeof block === "object" && block !== null) {
            const b = block as Record<string, unknown>
            if (b["type"] === "text" && typeof b["text"] === "string") {
              result.content = b["text"].slice(0, 300)
            } else if (b["type"] === "tool_use" && typeof b["name"] === "string") {
              result.tool = b["name"]
              const input = b["input"] as Record<string, unknown> | undefined
              if (input?.["command"] && typeof input["command"] === "string") {
                result.toolInput = input["command"].slice(0, 50)
              } else if (input?.["file_path"] && typeof input["file_path"] === "string") {
                result.toolInput = input["file_path"]
              }
            }
          }
        }
      }
    }

    condensed.push(result)
  }

  return condensed
}

/**
 * Parse LLM response to extract analysis result.
 */
export const parseAnalysisResponse = (response: string): Option.Option<AnalysisResult> => {
  // Clean up response - remove markdown code blocks and thinking tags
  let cleaned = response
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .replace(/<think>.*?<\/think>/gs, "")
    .trim()

  // Try to extract JSON object
  const jsonMatch = cleaned.match(/\{[^}]+\}/)
  if (jsonMatch) {
    cleaned = jsonMatch[0]
  }

  try {
    const parsed = JSON.parse(cleaned)
    const result = Schema.decodeUnknownOption(AnalysisResultSchema)(parsed)
    return result
  } catch {
    return Option.none()
  }
}

/**
 * Analyze session entries using LLM via direct HTTP call.
 * This bypasses the @effect/ai layer complexity for simple use cases.
 */
export const analyzeSession = (
  entries: ReadonlyArray<unknown>,
  config: LlmConfig = DEFAULT_CONFIG
) =>
  Effect.gen(function* () {
    if (entries.length === 0) {
      return Option.some<AnalysisResult>({
        state: "idle",
        detail: undefined,
        summary: "No recent activity"
      })
    }

    const condensed = condenseEntries(entries)
    const userPrompt = `Analyze these recent session entries (oldest to newest):\n\n${JSON.stringify(condensed)}`

    // Determine the API endpoint
    const baseUrl = config.baseUrl ?? (
      config.provider === "anthropic"
        ? "https://api.anthropic.com"
        : config.provider === "ollama"
          ? "http://localhost:11434/v1"
          : config.provider === "lmstudio"
            ? "http://localhost:1234/v1"
            : "https://api.openai.com/v1"
    )

    const endpoint = config.provider === "anthropic"
      ? `${baseUrl}/v1/messages`
      : `${baseUrl}/chat/completions`

    // Build request body based on provider
    const requestBody = config.provider === "anthropic"
      ? {
          model: config.model,
          max_tokens: 200,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userPrompt }]
        }
      : {
          model: config.model,
          max_tokens: 200,
          temperature: 0.1,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt }
          ]
        }

    // Build headers
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    }

    if (config.apiKey) {
      if (config.provider === "anthropic") {
        headers["x-api-key"] = config.apiKey
        headers["anthropic-version"] = "2023-06-01"
      } else {
        headers["Authorization"] = `Bearer ${config.apiKey}`
      }
    }

    const result = yield* Effect.tryPromise({
      try: async () => {
        const response = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(requestBody)
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${await response.text()}`)
        }

        const data = await response.json() as Record<string, unknown>

        // Extract text from response based on provider format
        let text: string
        if (config.provider === "anthropic") {
          const content = data["content"] as Array<{ text?: string }> | undefined
          text = content?.[0]?.text ?? ""
        } else {
          const choices = data["choices"] as Array<{ message?: { content?: string } }> | undefined
          text = choices?.[0]?.message?.content ?? ""
        }

        return text
      },
      catch: (error) => new LlmError({
        operation: "analyzeSession",
        message: String(error)
      })
    }).pipe(
      Effect.timeout(Duration.seconds(30)),
      Effect.catchAll(() => Effect.succeed(""))
    )

    if (result === "") {
      return Option.none<AnalysisResult>()
    }

    return parseAnalysisResponse(result)
  })

/**
 * Check if the LLM provider is available.
 */
export const isAvailable = (config: LlmConfig = DEFAULT_CONFIG) =>
  Effect.gen(function* () {
    // For local providers, try a simple health check
    if (config.provider === "ollama" || config.provider === "lmstudio") {
      const baseUrl = config.baseUrl ?? (
        config.provider === "ollama"
          ? "http://localhost:11434"
          : "http://localhost:1234/v1"
      )
      const modelsUrl = config.provider === "ollama"
        ? `${baseUrl}/api/tags`
        : `${baseUrl}/models`

      return yield* Effect.tryPromise({
        try: async () => {
          const response = await fetch(modelsUrl, {
            method: "GET",
            signal: AbortSignal.timeout(5000)
          })
          return response.ok
        },
        catch: () => false
      }).pipe(
        Effect.catchAll(() => Effect.succeed(false))
      )
    }

    // For cloud providers, assume available if API key is set
    return config.apiKey !== undefined && config.apiKey !== ""
  })

// ============================================================================
// In-Memory Cache
// ============================================================================

interface CacheEntry {
  result: AnalysisResult
  timestamp: number
}

const analysisCache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 10000 // 10 seconds

/**
 * Get cached analysis or run new analysis.
 */
export const cachedAnalyzeSession = (
  sessionKey: string,
  entries: ReadonlyArray<unknown>,
  config: LlmConfig = DEFAULT_CONFIG
) =>
  Effect.gen(function* () {
    const now = Date.now()
    const cached = analysisCache.get(sessionKey)

    // Return cached result if still valid
    if (cached && (now - cached.timestamp) < CACHE_TTL_MS) {
      return Option.some(cached.result)
    }

    // Run analysis
    const result = yield* analyzeSession(entries, config)

    // Cache successful results
    if (Option.isSome(result)) {
      analysisCache.set(sessionKey, {
        result: result.value,
        timestamp: now
      })
    }

    return result
  })

/**
 * Clear the analysis cache.
 */
export const clearCache = () =>
  Effect.sync(() => {
    analysisCache.clear()
  })

// ============================================================================
// Service Definition
// ============================================================================

export class LlmService extends Effect.Service<LlmService>()("LlmService", {
  accessors: true,
  effect: Effect.succeed({
    analyzeSession,
    isAvailable,
    cachedAnalyzeSession,
    clearCache,
    condenseEntries,
    parseAnalysisResponse
  })
}) {}
