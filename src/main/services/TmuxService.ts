import { Command } from "@effect/platform"
import { Effect, Option, Data, pipe } from "effect"

// ============================================================================
// Errors
// ============================================================================

export class TmuxError extends Data.TaggedError("TmuxError")<{
  readonly operation: string
  readonly message: string
}> {}

// ============================================================================
// Data Types
// ============================================================================

export interface TmuxSession {
  readonly name: string
  readonly path: string
  readonly attached: boolean
}

/**
 * Tool call parsed from pane content.
 */
export interface PaneToolCall {
  readonly displayName: string  // "Edit", "Write", "Bash", "Read"
  readonly target: string | null // File path or command
}

/**
 * State parsed from tmux pane content for real-time display.
 */
export interface PaneState {
  readonly recentCommands: readonly PaneToolCall[]
  readonly currentTodo: string | null
  readonly nextTodo: string | null
  readonly status: { state: string; detail?: string | undefined }
}

// ============================================================================
// Service Implementation
// ============================================================================

// Path to tmux - configurable for different platforms
const TMUX_PATH = process.platform === "darwin"
  ? "/opt/homebrew/bin/tmux"
  : "tmux"

const runTmuxCommand = (...args: ReadonlyArray<string>) =>
  pipe(
    Command.make(TMUX_PATH, ...args),
    Command.string,
    Effect.mapError((error) => new TmuxError({
      operation: args[0] ?? "unknown",
      message: String(error)
    })),
    Effect.option
  )

/**
 * Get all tmux sessions with their metadata.
 * Returns a Map of session name → TmuxSession.
 */
export const getSessions = Effect.gen(function* () {
  const output = yield* runTmuxCommand(
    "list-sessions",
    "-F",
    "#{session_name}|||#{session_path}|||#{session_attached}"
  )

  if (Option.isNone(output) || output.value.trim() === "") {
    return new Map<string, TmuxSession>()
  }

  const sessions = new Map<string, TmuxSession>()

  for (const line of output.value.trim().split("\n")) {
    const parts = line.split("|||")
    if (parts.length >= 3) {
      const name = parts[0]
      const path = parts[1]
      const attachedCount = parseInt(parts[2] ?? "0", 10)

      if (name && path) {
        sessions.set(name, {
          name,
          path,
          attached: attachedCount > 0
        })
      }
    }
  }

  return sessions
})

/**
 * Capture the visible content of a tmux pane.
 * Returns the last 50 lines of terminal output.
 */
export const capturePane = (session: string, window?: string) =>
  Effect.gen(function* () {
    const target = window ? `${session}:${window}` : session

    const output = yield* runTmuxCommand(
      "capture-pane",
      "-t",
      target,
      "-p",
      "-S",
      "-50"
    )

    return output
  })

/**
 * Focus a tmux session by activating the terminal app.
 * Note: On macOS, we activate VSCode/terminal rather than switching tmux clients.
 */
export const focusSession = (session: string, _window?: string) =>
  Effect.gen(function* () {
    // On macOS, we use AppleScript to activate the app
    // The Lua version uses Hammerspoon's application.find/activate
    // In Electron, we'll emit an event to the renderer to handle this
    // For now, just return success - the actual focus will be handled by IPC
    yield* Effect.log(`Focus requested for session: ${session}`)
    return void 0
  })

/**
 * Get GitHub repository name from a directory path.
 * Parses the git remote URL to extract the repo name.
 */
export const getGithubRepo = (path: string) =>
  Effect.gen(function* () {
    if (!path || path === "") {
      return Option.none<string>()
    }

    const output = yield* pipe(
      Command.make("git", "-C", path, "remote", "get-url", "origin"),
      Command.string,
      Effect.option
    )

    if (Option.isNone(output) || output.value.trim() === "") {
      return Option.none<string>()
    }

    const url = output.value.trim()

    // Parse repo name from various URL formats:
    // git@github.com:owner/repo.git
    // https://github.com/owner/repo.git
    // https://github.com/owner/repo
    const withGit = url.match(/[:/]([^/]+\/[^/]+)\.git\s*$/)
    const withoutGit = url.match(/[:/]([^/]+\/[^/]+)\s*$/)

    const ownerRepo = withGit?.[1] ?? withoutGit?.[1]
    if (!ownerRepo) {
      return Option.none<string>()
    }

    // Return just the repo name, not owner/repo
    const repoName = ownerRepo.split("/")[1]
    return repoName ? Option.some(repoName) : Option.none<string>()
  })

/**
 * Check if tmux server is running.
 */
export const isRunning = Effect.gen(function* () {
  const output = yield* runTmuxCommand("list-sessions")
  return Option.isSome(output) && output.value.trim() !== ""
})

/**
 * Detect session state from pane content using pattern matching.
 * This is a fallback when LLM analysis is not available.
 *
 * Detection priority (highest first):
 * 1. Permission prompts (requires user action)
 * 2. Background agents/active processing (Claude is working)
 * 3. Completion indicators (task finished)
 * 4. User input prompt (waiting for input)
 * 5. Error states
 * 6. Default idle
 */
export const detectPaneState = (content: Option.Option<string>) => {
  if (Option.isNone(content) || content.value.trim() === "") {
    return { state: "unknown" as const, detail: undefined }
  }

  const text = content.value
  const lines = text.split("\n")
  const lastLine = lines[lines.length - 1] ?? ""
  const lastFew = lines.slice(-5).join("\n")
  const recent = lines.slice(-20).join("\n")

  // Permission prompt patterns (user action required) - check FIRST
  if (recent.includes("Do you want to") || recent.includes("Esc to cancel")) {
    let action = "action"

    // Check for Bash permissions with specific command details
    // Matches patterns like "Bash(git commit:*)" or "Bash command" with git/npm/etc
    if (recent.includes("Bash")) {
      action = "bash"

      // Try to extract specific command from permission rule pattern: Bash(command:*)
      const bashRuleMatch = recent.match(/Bash\(([^:)]+)/)
      if (bashRuleMatch?.[1]) {
        const cmd = bashRuleMatch[1].trim()
        // Shorten common commands for display
        if (cmd.startsWith("git ")) {
          action = `bash (${cmd.slice(4)})` // "git commit" -> "bash (commit)"
        } else if (cmd.startsWith("npm ") || cmd.startsWith("pnpm ") || cmd.startsWith("yarn ")) {
          const parts = cmd.split(" ")
          action = `bash (${parts.slice(1).join(" ")})` // "npm install" -> "bash (install)"
        } else {
          action = `bash (${cmd})`
        }
      } else {
        // Fallback: try to detect command from the actual bash command line
        const cmdLineMatch = recent.match(/(?:&&\s*)?git\s+(commit|push|pull|merge|rebase|reset|checkout|branch|stash)/i)
        if (cmdLineMatch?.[1]) {
          action = `bash (${cmdLineMatch[1].toLowerCase()})`
        }
      }
    } else if (recent.includes("Edit") || recent.includes("edit")) {
      action = "file edit"
    } else if (recent.includes("Write") || recent.includes("write")) {
      action = "file write"
    } else if (recent.includes("Task")) {
      action = "task"
    }

    return { state: "permission" as const, detail: `approve: ${action}` }
  }

  // ==========================================================================
  // WORKING STATE DETECTION (high priority - check before waiting states)
  // ==========================================================================

  // Background agents actively running (Plan, Task, Explore, etc.)
  // These show a ">" prompt but Claude is actually working in background
  if (
    recent.includes("Wrangling") ||
    recent.includes("ctrl+c to interrupt") ||
    recent.includes("tokens)") ||
    recent.includes("thought for")
  ) {
    // Try to detect the specific agent type
    const agentMatch = recent.match(/(?:Plan|Task|Explore|Bash)\s*\(([^)]+)\)/)
    if (agentMatch) {
      const agentType = recent.match(/(Plan|Task|Explore|Bash)\s*\(/)?.[1]?.toLowerCase() ?? "agent"
      return { state: "working" as const, detail: `${agentType} running` }
    }
    return { state: "working" as const, detail: "processing" }
  }

  // Spinner characters (Claude actively working)
  if (/[✶✷✸✹✺✻✼✽]/.test(lastFew) || lastFew.includes("thinking)") || lastFew.includes("· thinking")) {
    return { state: "working" as const, detail: "processing" }
  }

  // Running/processing state (check before waiting states)
  if (recent.includes("Running") || recent.includes("⏳")) {
    const toolMatch = recent.match(/(\w+)\(/)
    const tool = toolMatch?.[1]?.toLowerCase() ?? "tool"
    return { state: "working" as const, detail: `running: ${tool}` }
  }

  // ==========================================================================
  // WAITING/COMPLETED STATE DETECTION
  // ==========================================================================

  // Completion indicators (task finished, waiting for next input)
  if (
    lastFew.includes("Sautéd for") ||
    lastFew.includes("Sauté'd for") ||
    lastFew.includes("Worked for") ||
    lastFew.includes("Cooked for") ||
    /Cost:\s*\$/.test(lastFew)
  ) {
    return { state: "waiting" as const, detail: "awaiting input" }
  }

  // PR/commit completion
  if (recent.includes("PR created:") || /https:\/\/github\.com\/[^\s]+\/pull\/\d+/.test(recent)) {
    return { state: "waiting" as const, detail: "PR created" }
  }

  if (recent.includes("commit") && /\b[0-9a-f]{7,40}\b/.test(recent)) {
    return { state: "waiting" as const, detail: "committed" }
  }

  // User input prompt (only if no working indicators found above)
  if (/^\s*❯/.test(lastLine) || /^\s*>\s*$/.test(lastLine)) {
    return { state: "waiting" as const, detail: "awaiting input" }
  }

  // Error states
  if (recent.includes("Error:") || recent.includes("error:") || recent.includes("failed")) {
    return { state: "error" as const, detail: "error occurred" }
  }

  // Default: idle
  return { state: "idle" as const, detail: undefined }
}

/**
 * Parse pane content for real-time tool calls and todo state.
 * This provides fast, local parsing without JSONL or LLM analysis.
 */
export const parsePaneContent = (content: string): PaneState => {
  const lines = content.split("\n")

  // Parse recent tool calls (✓ prefix indicates completed tools)
  const recentCommands: PaneToolCall[] = []
  const toolPattern = /^✓\s+(Edit|Write|Bash|Read|Glob|Grep|Task|TodoWrite|WebFetch|WebSearch)\s*(.*)$/

  for (const line of lines) {
    const match = line.match(toolPattern)
    if (match) {
      const displayName = match[1]!
      let target: string | null = match[2]?.trim() || null

      // Clean up target - extract just the file path or command
      if (target && target.startsWith("(")) {
        // Handle format like "(file.ts:123)" or "(git status)"
        const inner = target.match(/^\(([^)]+)\)/)
        target = inner?.[1] || target
      }

      // Don't add duplicates (keep most recent 5)
      if (!recentCommands.some(cmd => cmd.displayName === displayName && cmd.target === target)) {
        recentCommands.push({ displayName, target })
      }
    }
  }

  // Keep only the last 5 commands
  const trimmedCommands = recentCommands.slice(-5)

  // Parse todo state - look for TodoWrite output patterns
  let currentTodo: string | null = null
  let nextTodo: string | null = null

  // Look for todo patterns in the pane content
  // Pattern 1: [x]/[ ] checkbox style
  // Pattern 2: • ✓/→/pending bullet style
  // Pattern 3: Status indicators like ✶ or spinner for in-progress

  const todoPatterns = {
    // In-progress: [→], • →, or spinner ✶
    inProgress: /(?:\[→\]|\[✶\]|•\s*→|✶)\s*(.+)/,
    // Pending: [ ], • (without check), or just bullet
    pending: /(?:\[\s\]|•\s*)(?!✓|→)(.+)/,
    // Completed: [x], • ✓
    completed: /(?:\[x\]|\[✓\]|•\s*✓)\s*(.+)/
  }

  // Scan for todo items (check recent lines for todo output)
  const recentLines = lines.slice(-30)
  const todos: { status: "in_progress" | "pending" | "completed"; text: string }[] = []

  for (const line of recentLines) {
    const inProgressMatch = line.match(todoPatterns.inProgress)
    if (inProgressMatch) {
      todos.push({ status: "in_progress", text: inProgressMatch[1]!.trim() })
      continue
    }

    const pendingMatch = line.match(todoPatterns.pending)
    if (pendingMatch) {
      todos.push({ status: "pending", text: pendingMatch[1]!.trim() })
      continue
    }

    // We could track completed too, but for display we mainly care about current/next
  }

  // Set current (in_progress) and next (first pending)
  const inProgressTodo = todos.find(t => t.status === "in_progress")
  const pendingTodos = todos.filter(t => t.status === "pending")

  currentTodo = inProgressTodo?.text || null
  nextTodo = pendingTodos[0]?.text || null

  // Get status using existing detection logic
  const status = detectPaneState(Option.some(content))

  return {
    recentCommands: trimmedCommands,
    currentTodo,
    nextTodo,
    status
  }
}

// ============================================================================
// Service Definition
// ============================================================================

export class TmuxService extends Effect.Service<TmuxService>()("TmuxService", {
  accessors: true,
  effect: Effect.succeed({
    getSessions,
    capturePane,
    focusSession,
    getGithubRepo,
    isRunning,
    detectPaneState,
    parsePaneContent
  })
}) {}
