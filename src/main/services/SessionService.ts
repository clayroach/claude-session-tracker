import { FileSystem } from "@effect/platform"
import { Effect, Option, Ref, Schedule, Duration, pipe } from "effect"
import { getSessions, capturePane, getGithubRepo, detectPaneState, type TmuxSession } from "./TmuxService.js"
import {
  findSessions,
  parseSession,
  calculateContextPercent,
  determineStatus,
  generateSummary,
  pathToClaudeProject,
  timeAgo,
  type SessionData,
  type SessionStatus
} from "./ClaudeService.js"
import { getCachedAnalysis, analyzeAndCache, isAvailable, type LlmConfig, type AnalysisResult } from "./LlmService.js"

// ============================================================================
// Configuration
// ============================================================================

// StatusSource is exported from SettingsStore.ts
type StatusSource = "tmux" | "jsonl" | "hybrid"

export interface SessionConfig {
  /** Pattern to match tmux session names (regex string) */
  readonly sessionPattern: string
  /** Maximum age of Claude sessions to include (hours) */
  readonly maxSessionAgeHours: number
  /** Polling interval for session refresh (milliseconds) */
  readonly pollIntervalMs: number
  /** LLM configuration for enhanced analysis */
  readonly llmConfig?: LlmConfig
  /** Status detection source: tmux (fast), jsonl (full), hybrid (mixed) */
  readonly statusSource?: StatusSource
}

const DEFAULT_CONFIG: SessionConfig = {
  sessionPattern: ".*",
  maxSessionAgeHours: 48,
  pollIntervalMs: 60000, // 60 seconds (reduced LLM load)
  statusSource: "hybrid" // Default to hybrid: pane for status, JSONL for metadata
}

// ============================================================================
// Data Types
// ============================================================================

export interface TrackedSession {
  readonly tmux: TmuxSession
  readonly claude: SessionData | null
  readonly displayName: string
  readonly repo: string | null
  readonly status: SessionStatus
  readonly statusDetail: string | null
  readonly summary: string
  readonly contextPercent: number
  readonly lastActivity: string
  readonly lastTimestamp: number // Unix timestamp for sorting (from claude or file mtime)
}

// Serializable command for IPC
export interface SerializedCommand {
  readonly displayName: string
  readonly target: string | null
}

// Serializable version for IPC
export interface SerializedSession {
  readonly name: string
  readonly displayName: string
  readonly attached: boolean
  readonly path: string
  readonly repo: string | null
  readonly status: string
  readonly statusDetail: string | null
  readonly summary: string
  readonly contextPercent: number
  readonly lastActivity: string
  readonly model: string | null
  readonly gitBranch: string | null
  readonly sessionSlug: string | null // Claude session name/slug
  readonly recentCommands: readonly SerializedCommand[]
  readonly currentTodo: string | null
  readonly nextTodo: string | null
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert TrackedSession to serializable format for IPC.
 */
export const serializeSession = (session: TrackedSession): SerializedSession => ({
  name: session.tmux.name,
  displayName: session.displayName,
  attached: session.tmux.attached,
  path: session.tmux.path,
  repo: session.repo,
  status: session.status._tag,
  statusDetail: session.statusDetail,
  summary: session.summary,
  contextPercent: session.contextPercent,
  lastActivity: session.lastActivity,
  model: session.claude ? Option.getOrNull(session.claude.model) : null,
  gitBranch: session.claude ? Option.getOrNull(session.claude.gitBranch) : null,
  sessionSlug: session.claude ? Option.getOrNull(session.claude.slug) : null,
  recentCommands: session.claude?.recentCommands.map(cmd => ({
    displayName: cmd.displayName,
    target: cmd.target
  })) ?? [],
  currentTodo: session.claude?.todoState?.current ?? null,
  nextTodo: session.claude?.todoState?.next ?? null
})

/**
 * Create a display name from tmux session name and repo.
 */
const createDisplayName = (
  sessionName: string,
  repo: Option.Option<string>
): string => {
  if (Option.isSome(repo)) {
    return repo.value
  }
  // Clean up session name: remove leading "atrim-" or similar patterns
  return sessionName.replace(/^atrim[-_]?/, "")
}

/**
 * Merge LLM analysis with status determination.
 */
const mergeAnalysis = (
  baseStatus: SessionStatus,
  analysis: Option.Option<AnalysisResult>
): { status: SessionStatus; detail: string | null; summary: string | null } => {
  if (Option.isNone(analysis)) {
    return {
      status: baseStatus,
      detail: getStatusDetail(baseStatus),
      summary: null
    }
  }

  const result = analysis.value

  // Map LLM state to SessionStatus
  let status: SessionStatus
  switch (result.state) {
    case "working":
      status = { _tag: "working", tool: result.detail ?? "processing" }
      break
    case "permission":
      status = { _tag: "permission", tool: result.detail ?? "action" }
      break
    case "waiting":
      status = { _tag: "waiting", reason: result.detail ?? "awaiting input" }
      break
    case "idle":
    case "unknown":
    default:
      status = baseStatus
  }

  return {
    status,
    detail: result.detail ?? null,
    summary: result.summary ?? null
  }
}

/**
 * Extract detail string from SessionStatus.
 */
const getStatusDetail = (status: SessionStatus): string | null => {
  switch (status._tag) {
    case "working":
      return status.tool
    case "waiting":
      return status.reason
    case "permission":
      return status.tool
    case "error":
      return status.message
    default:
      return null
  }
}

/**
 * Map tmux pane state to SessionStatus.
 */
const mapPaneStateToStatus = (paneState: { state: string; detail?: string | undefined }): SessionStatus => {
  switch (paneState.state) {
    case "working":
      return { _tag: "working", tool: paneState.detail ?? "processing" }
    case "permission":
      return { _tag: "permission", tool: paneState.detail ?? "action" }
    case "waiting":
      return { _tag: "waiting", reason: paneState.detail ?? "input" }
    case "error":
      return { _tag: "error", message: paneState.detail ?? "error" }
    case "idle":
    default:
      return { _tag: "idle" }
  }
}

// ============================================================================
// Service Implementation
// ============================================================================

/**
 * Refresh all tracked sessions.
 * This is the main orchestration function that combines all services.
 *
 * Deduplicates sessions by Claude project directory, keeping only the
 * "best" tmux session per project (named sessions preferred over numeric,
 * then most recent activity).
 */
// Cache LLM availability - reset when config changes
let llmAvailableCache: boolean | null = null
let lastLlmConfigJson: string | null = null

/** Reset LLM cache when settings change */
export const resetLlmCache = () => {
  llmAvailableCache = null
  lastLlmConfigJson = null
}

export const refreshSessions = (config: SessionConfig = DEFAULT_CONFIG) =>
  Effect.gen(function* () {
    // Get all tmux sessions
    const tmuxSessions = yield* getSessions

    // Filter by pattern
    const pattern = new RegExp(config.sessionPattern)
    const matchedSessions = Array.from(tmuxSessions.values()).filter(
      (session) => pattern.test(session.name)
    )

    if (matchedSessions.length === 0) {
      return []
    }

    // Check LLM availability (reset cache if config changed)
    let llmAvailable = false
    if (config.llmConfig) {
      const configJson = JSON.stringify(config.llmConfig)
      if (llmAvailableCache === null || lastLlmConfigJson !== configJson) {
        llmAvailableCache = yield* isAvailable(config.llmConfig)
        lastLlmConfigJson = configJson
      }
      llmAvailable = llmAvailableCache
    } else {
      // Reset cache if LLM is disabled
      llmAvailableCache = null
      lastLlmConfigJson = null
    }

    // Process each session in parallel
    const trackedSessions = yield* Effect.all(
      matchedSessions.map((tmux) =>
        processSession(tmux, config, llmAvailable)
      ),
      { concurrency: 5 }
    )

    // Deduplicate by Claude project directory
    // Keep only the "best" session per project:
    // 1. Prefer named sessions over numeric ones
    // 2. If same type, prefer most recent activity
    const projectBest = new Map<string, TrackedSession>()

    for (const session of trackedSessions) {
      const projectDir = pathToClaudeProject(session.tmux.path)
      const existing = projectBest.get(projectDir)

      if (!existing) {
        projectBest.set(projectDir, session)
        continue
      }

      const isNumeric = /^\d+$/.test(session.tmux.name)
      const existingIsNumeric = /^\d+$/.test(existing.tmux.name)
      const timestamp = session.lastTimestamp
      const existingTimestamp = existing.lastTimestamp

      let shouldReplace = false

      if (existingIsNumeric && !isNumeric) {
        // New is named, existing is numeric -> replace
        shouldReplace = true
      } else if (!existingIsNumeric && isNumeric) {
        // Existing is named, new is numeric -> keep existing
        shouldReplace = false
      } else {
        // Same type: prefer more recent activity
        shouldReplace = timestamp > existingTimestamp
      }

      if (shouldReplace) {
        projectBest.set(projectDir, session)
      }
    }

    // Convert to array and sort by last activity (most recent first)
    return Array.from(projectBest.values()).sort((a, b) => {
      return b.lastTimestamp - a.lastTimestamp
    })
  })

/**
 * Process a single tmux session to create TrackedSession.
 *
 * Status detection modes:
 * - "tmux": Fast, real-time status from pane content only. No JSONL parsing.
 * - "hybrid": Status from pane, metadata from JSONL on mtime change.
 * - "jsonl": Full JSONL parsing with optional LLM enhancement.
 */
const processSession = (
  tmux: TmuxSession,
  config: SessionConfig,
  llmAvailable: boolean
) =>
  Effect.gen(function* () {
    const statusSource = config.statusSource ?? "tmux"

    // Get repo name
    const repoOption = yield* getGithubRepo(tmux.path)
    const repo = Option.getOrNull(repoOption)

    let claude: SessionData | null = null
    let contextPercent = 0
    let status: SessionStatus = { _tag: "idle" }
    let statusDetail: string | null = null
    let summary = "No recent activity"
    let lastActivity = "—"
    let lastTimestamp = 0 // Unix timestamp for sorting

    // =========================================================================
    // Step 1: Capture tmux pane for status (tmux and hybrid modes)
    // =========================================================================
    if (statusSource === "tmux" || statusSource === "hybrid") {
      const paneContent = yield* capturePane(tmux.name)
      const paneState = detectPaneState(paneContent)

      if (paneState.state !== "unknown") {
        status = mapPaneStateToStatus(paneState)
        statusDetail = paneState.detail ?? null
      }
    }

    // =========================================================================
    // Step 2: Find Claude session file info
    // =========================================================================
    const projectDir = pathToClaudeProject(tmux.path)
    const claudeSessions = yield* findSessions(
      projectDir,
      1,
      config.maxSessionAgeHours
    )

    // =========================================================================
    // Step 3: Parse JSONL based on mode
    // =========================================================================
    if (claudeSessions.length > 0) {
      const sessionFile = claudeSessions[0]!

      if (statusSource === "tmux") {
        // tmux mode: Skip JSONL parsing entirely - fastest path
        // We still have lastActivity from the file mtime (already in seconds)
        const now = Math.floor(Date.now() / 1000)
        lastTimestamp = sessionFile.mtime
        const lastActivitySeconds = now - lastTimestamp
        lastActivity = timeAgo(lastActivitySeconds)
        // Summary will be generated in Step 4 based on status
      } else if (statusSource === "hybrid") {
        // hybrid mode: Parse JSONL for metadata, use pane for status
        const sessionDataOpt = yield* parseSession(sessionFile.path)

        if (Option.isSome(sessionDataOpt)) {
          claude = sessionDataOpt.value
          contextPercent = calculateContextPercent(claude, claude.model)
          summary = generateSummary(claude.messages, claude.assistantMessages, 150)

          const now = Math.floor(Date.now() / 1000)
          lastTimestamp = claude.lastTimestamp
          const lastActivitySeconds = now - lastTimestamp
          lastActivity = timeAgo(lastActivitySeconds)

          // Optionally enhance with LLM analysis (same as jsonl mode)
          // Only analyze if: LLM available, session active (<10min)
          console.log(`[LLM Debug] Session: ${tmux.name}, llmAvailable: ${llmAvailable}, hasConfig: ${!!config.llmConfig}, lastActivitySeconds: ${lastActivitySeconds}`)
          if (llmAvailable && config.llmConfig && lastActivitySeconds < 600) {
            const cacheKey = `${sessionFile.sessionId}-${sessionFile.mtime}`

            let analysis = yield* getCachedAnalysis(cacheKey)
            console.log(`[LLM Debug] Cache key: ${cacheKey}, cached: ${Option.isSome(analysis)}`)

            if (Option.isNone(analysis)) {
              const entries = yield* readRecentEntries(sessionFile.path)
              console.log(`[LLM Debug] Entries count: ${entries.length}`)
              analysis = yield* analyzeAndCache(cacheKey, entries, config.llmConfig)
            }

            console.log(`[LLM Debug] Analysis result: ${Option.isSome(analysis) ? JSON.stringify(analysis.value) : 'none'}`)
            // In hybrid mode, only use LLM for summary (status comes from pane)
            if (Option.isSome(analysis) && analysis.value.summary) {
              summary = analysis.value.summary
              console.log(`[LLM Debug] Set summary: ${summary}`)
            }
          }
        } else {
          // Fallback to mtime if parsing fails
          const now = Math.floor(Date.now() / 1000)
          lastTimestamp = sessionFile.mtime
          const lastActivitySeconds = now - lastTimestamp
          lastActivity = timeAgo(lastActivitySeconds)
        }
        // Note: Status comes from pane detection (Step 1), not JSONL
      } else {
        // jsonl mode: Full parsing with optional LLM enhancement (original behavior)
        const sessionDataOpt = yield* parseSession(sessionFile.path)

        if (Option.isSome(sessionDataOpt)) {
          claude = sessionDataOpt.value
          contextPercent = calculateContextPercent(claude, claude.model)

          const now = Math.floor(Date.now() / 1000)
          lastTimestamp = claude.lastTimestamp
          const lastActivitySeconds = now - lastTimestamp
          lastActivity = timeAgo(lastActivitySeconds)

          // Determine status from JSONL data (override any pane status)
          status = determineStatus(claude, tmux.attached, lastActivitySeconds)
          statusDetail = getStatusDetail(status)
          summary = generateSummary(claude.messages, claude.assistantMessages, 150)

          // Optionally enhance with LLM analysis
          // Only analyze if: LLM available, session active (<10min)
          if (llmAvailable && config.llmConfig && lastActivitySeconds < 600) {
            const cacheKey = `${sessionFile.sessionId}-${sessionFile.mtime}`

            let analysis = yield* getCachedAnalysis(cacheKey)

            if (Option.isNone(analysis)) {
              const entries = yield* readRecentEntries(sessionFile.path)
              analysis = yield* analyzeAndCache(cacheKey, entries, config.llmConfig)
            }

            const merged = mergeAnalysis(status, analysis)
            status = merged.status
            statusDetail = merged.detail
            if (merged.summary) {
              summary = merged.summary
            }
          }
        }
      }
    }

    // =========================================================================
    // Step 4: Enhance status based on activity time (tmux/hybrid modes)
    // =========================================================================
    if (statusSource === "tmux" || statusSource === "hybrid") {
      // If pane detection didn't find a specific state, use time-based status
      if (status._tag === "idle" && lastTimestamp > 0) {
        const now = Math.floor(Date.now() / 1000)
        const lastActivitySeconds = now - lastTimestamp

        if (lastActivitySeconds < 60) {
          // Very recent activity - likely working
          status = { _tag: "working", tool: "active" }
          statusDetail = "active"
        } else if (tmux.attached && lastActivitySeconds < 300) {
          // Attached and recent activity
          status = { _tag: "active" }
          statusDetail = null
        }
      }
    }

    // Generate summary from status only for tmux mode (hybrid uses JSONL summary)
    if (statusSource === "tmux" && summary === "No recent activity") {
      if (statusDetail) {
        summary = statusDetail
      } else if (status._tag !== "idle") {
        summary = status._tag
      } else {
        summary = "Session active"
      }
    }

    const displayName = createDisplayName(tmux.name, repoOption)

    return {
      tmux,
      claude,
      displayName,
      repo,
      status,
      statusDetail,
      summary,
      contextPercent,
      lastActivity,
      lastTimestamp
    } satisfies TrackedSession
  })

/**
 * Read recent JSONL entries for LLM analysis.
 */
const readRecentEntries = (jsonlPath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem

    const content = yield* fs.readFileString(jsonlPath).pipe(
      Effect.catchAll(() => Effect.succeed(""))
    )

    if (content === "") {
      return [] as unknown[]
    }

    const lines = content.trim().split("\n")
    const recentLines = lines.slice(-50) // Last 50 entries

    const entries: unknown[] = []
    for (const line of recentLines) {
      try {
        entries.push(JSON.parse(line))
      } catch {
        // Skip invalid JSON
      }
    }

    return entries
  })

// ============================================================================
// Session Store (using Effect Ref for state)
// ============================================================================

/**
 * Create a managed session store that handles polling and state updates.
 */
export const makeSessionStore = (config: SessionConfig = DEFAULT_CONFIG) =>
  Effect.gen(function* () {
    // Create mutable ref for session state
    const sessionsRef = yield* Ref.make<ReadonlyArray<TrackedSession>>([])

    // Refresh function
    const refresh = Effect.gen(function* () {
      const sessions = yield* refreshSessions(config)
      yield* Ref.set(sessionsRef, sessions)
      return sessions
    })

    // Get current sessions
    const getSessions = Ref.get(sessionsRef)

    // Start polling scheduler
    const startPolling = (
      onUpdate: (sessions: ReadonlyArray<SerializedSession>) => void
    ) =>
      pipe(
        refresh,
        Effect.tap((sessions) =>
          Effect.sync(() => onUpdate(sessions.map(serializeSession)))
        ),
        Effect.repeat(
          Schedule.fixed(Duration.millis(config.pollIntervalMs))
        )
      )

    return {
      refresh,
      getSessions,
      startPolling,
      getSerializedSessions: Effect.gen(function* () {
        const sessions = yield* getSessions
        return sessions.map(serializeSession)
      })
    }
  })

export type SessionStore = Effect.Effect.Success<ReturnType<typeof makeSessionStore>>

// ============================================================================
// Service Definition
// ============================================================================

export class SessionService extends Effect.Service<SessionService>()("SessionService", {
  accessors: true,
  effect: Effect.succeed({
    refreshSessions,
    makeSessionStore,
    serializeSession,
    DEFAULT_CONFIG
  })
}) {}
