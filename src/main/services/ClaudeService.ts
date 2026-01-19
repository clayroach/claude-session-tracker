import { FileSystem, Path } from "@effect/platform"
import { Effect, Option, Data, Schema } from "effect"
import * as os from "node:os"

// ============================================================================
// Errors
// ============================================================================

export class ClaudeParseError extends Data.TaggedError("ClaudeParseError")<{
  readonly path: string
  readonly reason: string
}> {}

// ============================================================================
// Schemas for JSONL Entries
// ============================================================================

const ToolUseBlock = Schema.Struct({
  type: Schema.Literal("tool_use"),
  id: Schema.String,
  name: Schema.String,
  input: Schema.optional(Schema.Unknown)
})

const TextBlock = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String
})

const ToolResultBlock = Schema.Struct({
  type: Schema.Literal("tool_result"),
  tool_use_id: Schema.String
})

const ContentBlock = Schema.Union(ToolUseBlock, TextBlock, ToolResultBlock)

const Usage = Schema.Struct({
  input_tokens: Schema.optional(Schema.Number),
  output_tokens: Schema.optional(Schema.Number),
  cache_read_input_tokens: Schema.optional(Schema.Number)
})

const AssistantMessage = Schema.Struct({
  model: Schema.optional(Schema.String),
  usage: Schema.optional(Usage),
  content: Schema.optional(Schema.Union(
    Schema.String,
    Schema.Array(ContentBlock)
  ))
})

const UserMessageContent = Schema.Union(
  Schema.String,
  Schema.Array(ContentBlock)
)

const UserMessage = Schema.Struct({
  content: Schema.optional(UserMessageContent)
})

const AssistantEntry = Schema.Struct({
  type: Schema.Literal("assistant"),
  timestamp: Schema.optional(Schema.String),
  message: Schema.optional(AssistantMessage)
})

const UserEntry = Schema.Struct({
  type: Schema.Literal("user"),
  timestamp: Schema.optional(Schema.String),
  message: Schema.optional(UserMessage)
})

const MetadataEntry = Schema.Struct({
  slug: Schema.optional(Schema.String),
  gitBranch: Schema.optional(Schema.String),
  sessionId: Schema.optional(Schema.String)
})

// ============================================================================
// Data Types
// ============================================================================

export interface TokenUsage {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly total: number
}

export interface ToolInfo {
  readonly id: string
  readonly name: string
  readonly input: unknown
  readonly timestamp: string | undefined
}

export interface SessionData {
  readonly tokens: TokenUsage
  readonly messages: readonly string[]
  readonly assistantMessages: readonly string[]
  readonly model: Option.Option<string>
  readonly slug: Option.Option<string>
  readonly gitBranch: Option.Option<string>
  readonly sessionId: Option.Option<string>
  readonly lastTimestamp: number
  readonly activeTool: Option.Option<string>
  readonly pendingTool: Option.Option<string>
  readonly pendingToolIds: Map<string, ToolInfo>
  readonly currentContext: number
  readonly lastMessageRole: Option.Option<"user" | "assistant">
}

export interface SessionFile {
  readonly path: string
  readonly mtime: number
  readonly age: number
  readonly sessionId: string
}

export type SessionStatus =
  | { readonly _tag: "active" }
  | { readonly _tag: "working"; readonly tool: string }
  | { readonly _tag: "waiting"; readonly reason: string }
  | { readonly _tag: "permission"; readonly tool: string }
  | { readonly _tag: "idle" }
  | { readonly _tag: "error"; readonly message: string }

// ============================================================================
// Configuration
// ============================================================================

const CLAUDE_PROJECTS_DIR = `${os.homedir()}/.claude/projects/`

const CONTEXT_WINDOWS: Record<string, number> = {
  "claude-opus-4-5-20251101": 200000,
  "claude-sonnet-4-20250514": 1000000,
  "claude-sonnet-4-5-20250514": 1000000,
  "claude-sonnet-4-5-20250929": 1000000,
  default: 200000
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert a filesystem path to Claude project directory name.
 * e.g., "/Users/foo/bar" -> "-Users-foo-bar"
 */
export const pathToClaudeProject = (path: string): string => {
  const trimmed = path.replace(/\/$/, "")
  return trimmed.replace(/\//g, "-")
}

/**
 * Parse ISO 8601 timestamp to Unix time.
 */
export const parseTimestamp = (isoStr: string): number => {
  const date = new Date(isoStr)
  return isNaN(date.getTime()) ? 0 : Math.floor(date.getTime() / 1000)
}

/**
 * Convert seconds to human-readable "time ago" format.
 */
export const timeAgo = (seconds: number): string => {
  if (seconds < 0) return "unknown"
  if (seconds < 60) return "now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

// ============================================================================
// Service Implementation
// ============================================================================

/**
 * Find all recent JSONL session files for a project directory.
 */
export const findSessions = (
  projectDir: string,
  maxSessions = 5,
  maxAgeHours = 24
) =>
  Effect.gen(function* () {
    if (!projectDir || projectDir === "") {
      return []
    }

    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const fullPath = path.join(CLAUDE_PROJECTS_DIR, projectDir)

    // Check if directory exists
    const exists = yield* fs.exists(fullPath)
    if (!exists) {
      return []
    }

    // List all files in the directory
    const files = yield* fs.readDirectory(fullPath).pipe(
      Effect.catchAll(() => Effect.succeed([]))
    )

    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"))
    const now = Math.floor(Date.now() / 1000)
    const maxAgeSeconds = maxAgeHours * 3600

    // Get stats for ALL files first, then sort and filter
    // This ensures we find the most recent file even if readDirectory
    // returns files in arbitrary order
    const allSessionFiles: SessionFile[] = []

    for (const file of jsonlFiles) {
      const filePath = path.join(fullPath, file)
      const stat = yield* fs.stat(filePath).pipe(Effect.option)

      if (Option.isSome(stat) && Option.isSome(stat.value.mtime)) {
        const mtime = Math.floor(stat.value.mtime.value.getTime() / 1000)
        const age = now - mtime

        if (age <= maxAgeSeconds) {
          const sessionId = file.replace(".jsonl", "")
          allSessionFiles.push({ path: filePath, mtime, age, sessionId })
        }
      }
    }

    // Sort by mtime descending (most recent first), then take maxSessions
    return allSessionFiles.sort((a, b) => b.mtime - a.mtime).slice(0, maxSessions)
  })

/**
 * Parse a JSONL session file to extract relevant data.
 */
export const parseSession = (jsonlPath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem

    const content = yield* fs.readFileString(jsonlPath).pipe(
      Effect.mapError(() => new ClaudeParseError({
        path: jsonlPath,
        reason: "Failed to read file"
      }))
    )

    const lines = content.trim().split("\n")
    if (lines.length === 0) {
      return Option.none<SessionData>()
    }

    // Initialize session data
    let tokens: TokenUsage = { input: 0, output: 0, cacheRead: 0, total: 0 }
    const messages: string[] = []
    const assistantMessages: string[] = []
    let model: Option.Option<string> = Option.none()
    let slug: Option.Option<string> = Option.none()
    let gitBranch: Option.Option<string> = Option.none()
    let sessionId: Option.Option<string> = Option.none()
    let lastTimestamp = 0
    let activeTool: Option.Option<string> = Option.none()
    let pendingTool: Option.Option<string> = Option.none()
    const pendingToolIds = new Map<string, ToolInfo>()
    let currentContext = 0
    let lastMessageRole: Option.Option<"user" | "assistant"> = Option.none()

    // Process head (first 10 lines) for metadata
    const headLines = lines.slice(0, 10)
    for (const line of headLines) {
      try {
        const entry = JSON.parse(line) as unknown
        const metadata = Schema.decodeUnknownOption(MetadataEntry)(entry)
        if (Option.isSome(metadata)) {
          if (metadata.value.slug && Option.isNone(slug)) {
            slug = Option.some(metadata.value.slug)
          }
          if (metadata.value.gitBranch && Option.isNone(gitBranch)) {
            gitBranch = Option.some(metadata.value.gitBranch)
          }
          if (metadata.value.sessionId && Option.isNone(sessionId)) {
            sessionId = Option.some(metadata.value.sessionId)
          }
        }
      } catch {
        // Skip invalid JSON lines
      }
    }

    // Process tail (last 100 lines) for recent activity
    const tailLines = lines.slice(-100)
    for (const line of tailLines) {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>

        // Extract metadata from any entry
        if (entry["slug"] && typeof entry["slug"] === "string") {
          slug = Option.some(entry["slug"])
        }
        if (entry["gitBranch"] && typeof entry["gitBranch"] === "string") {
          gitBranch = Option.some(entry["gitBranch"])
        }
        if (entry["sessionId"] && typeof entry["sessionId"] === "string") {
          sessionId = Option.some(entry["sessionId"])
        }

        // Track timestamp
        if (entry["timestamp"] && typeof entry["timestamp"] === "string") {
          const ts = parseTimestamp(entry["timestamp"])
          if (ts > lastTimestamp) lastTimestamp = ts
        }

        // Process assistant entries
        const assistantEntry = Schema.decodeUnknownOption(AssistantEntry)(entry)
        if (Option.isSome(assistantEntry) && assistantEntry.value.message) {
          lastMessageRole = Option.some("assistant")
          const msg = assistantEntry.value.message

          if (msg.model) {
            model = Option.some(msg.model)
          }

          if (msg.usage) {
            const inputTokens = msg.usage.input_tokens ?? 0
            const cacheRead = msg.usage.cache_read_input_tokens ?? 0
            currentContext = inputTokens + cacheRead

            tokens = {
              input: inputTokens,
              output: msg.usage.output_tokens ?? 0,
              cacheRead,
              total: inputTokens + (msg.usage.output_tokens ?? 0) + cacheRead
            }
          }

          // Check content blocks
          if (msg.content && Array.isArray(msg.content)) {
            activeTool = Option.none()
            for (const block of msg.content) {
              if (block.type === "tool_use" && "id" in block && "name" in block) {
                activeTool = Option.some(block.name as string)
                const toolInfo: ToolInfo = {
                  id: block.id as string,
                  name: block.name as string,
                  input: "input" in block ? block.input : undefined,
                  timestamp: assistantEntry.value.timestamp
                }
                pendingToolIds.set(toolInfo.id, toolInfo)
                pendingTool = Option.some(block.name as string)
              } else if (block.type === "text" && "text" in block) {
                assistantMessages.push(block.text as string)
              }
            }
          }
        }

        // Process user entries
        const userEntry = Schema.decodeUnknownOption(UserEntry)(entry)
        if (Option.isSome(userEntry) && userEntry.value.message) {
          lastMessageRole = Option.some("user")
          const content = userEntry.value.message.content

          if (typeof content === "string") {
            messages.push(content)
          } else if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "text" && "text" in block) {
                messages.push(block.text as string)
              } else if (block.type === "tool_result" && "tool_use_id" in block) {
                // Tool result resolves pending tool
                pendingToolIds.delete(block.tool_use_id as string)
              }
            }
          }

          // Update pending tool based on remaining unresolved
          pendingTool = Option.none()
          for (const [, toolInfo] of pendingToolIds) {
            pendingTool = Option.some(toolInfo.name)
            break
          }
        }
      } catch {
        // Skip invalid JSON lines
      }
    }

    if (lastTimestamp === 0) {
      return Option.none<SessionData>()
    }

    return Option.some<SessionData>({
      tokens,
      messages,
      assistantMessages,
      model,
      slug,
      gitBranch,
      sessionId,
      lastTimestamp,
      activeTool,
      pendingTool,
      pendingToolIds,
      currentContext,
      lastMessageRole
    })
  })

/**
 * Calculate context window utilization percentage.
 */
export const calculateContextPercent = (
  data: SessionData,
  modelName: Option.Option<string>
): number => {
  const contextUsed = data.currentContext

  // Get base context window size for this model
  const modelStr = Option.getOrElse(modelName, () => "default")
  const baseWindow = CONTEXT_WINDOWS[modelStr] ?? CONTEXT_WINDOWS["default"]!

  // If context used exceeds base window, model must be using extended context (1M)
  const window = contextUsed > baseWindow ? 1000000 : baseWindow

  const percent = Math.floor((contextUsed / window) * 100)
  return Math.min(percent, 100)
}

/**
 * Determine session status based on activity.
 */
export const determineStatus = (
  data: SessionData,
  isAttached: boolean,
  lastActivitySeconds: number
): SessionStatus => {
  // Check for pending tool permission
  if (Option.isSome(data.pendingTool) && lastActivitySeconds < 600) {
    const tool = data.pendingTool.value
    let detail: string
    if (tool === "Bash") detail = "bash"
    else if (tool === "Edit" || tool === "Write") detail = "file edit"
    else if (tool === "TodoWrite") detail = "todo"
    else detail = tool.toLowerCase()
    return { _tag: "permission", tool: detail }
  }

  // Only consider "working" if activity is very recent (< 2 min)
  if (Option.isSome(data.activeTool) && lastActivitySeconds < 120) {
    return { _tag: "working", tool: data.activeTool.value.toLowerCase() }
  }

  // Waiting for user input
  if (
    Option.isSome(data.lastMessageRole) &&
    data.lastMessageRole.value === "assistant" &&
    lastActivitySeconds < 600
  ) {
    return { _tag: "waiting", reason: "awaiting input" }
  }

  // Active session
  if (isAttached && lastActivitySeconds < 120) {
    return { _tag: "active" }
  }

  // Default: idle
  return { _tag: "idle" }
}

/**
 * Generate a summary from recent messages.
 */
export const generateSummary = (
  messages: readonly string[],
  assistantMessages: readonly string[],
  maxLength = 120
): string => {
  // Helper to check if a message is a system message
  const isSystemMessage = (msg: string): boolean => {
    if (!msg) return true
    if (msg.startsWith("<")) return true // XML tags
    if (msg.startsWith("/")) return true // Slash commands
    if (msg.includes("command-name")) return true
    if (msg.includes("system-reminder")) return true
    if (msg.trim() === "") return true
    return false
  }

  // Find last non-system user message
  let lastUserMsg: string | undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg && !isSystemMessage(msg)) {
      lastUserMsg = msg
      break
    }
  }

  // Find last assistant message
  let lastAssistantMsg: string | undefined
  for (let i = assistantMessages.length - 1; i >= 0; i--) {
    const msg = assistantMessages[i]
    if (msg && msg.trim() !== "") {
      lastAssistantMsg = msg
      break
    }
  }

  const lastMsg = lastUserMsg ?? lastAssistantMsg

  if (!lastMsg) {
    return "No recent activity"
  }

  // Clean and truncate
  const cleaned = lastMsg
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  if (cleaned.length <= maxLength) {
    return cleaned
  }

  return cleaned.slice(0, maxLength - 3) + "..."
}

// ============================================================================
// Service Definition
// ============================================================================

export class ClaudeService extends Effect.Service<ClaudeService>()("ClaudeService", {
  accessors: true,
  effect: Effect.succeed({
    findSessions,
    parseSession,
    calculateContextPercent,
    determineStatus,
    generateSummary,
    pathToClaudeProject,
    parseTimestamp,
    timeAgo
  })
}) {}
