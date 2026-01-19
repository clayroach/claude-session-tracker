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

  // Active processing (Claude is working)
  if (lastFew.includes("ctrl+c to interrupt") || lastFew.includes("tokens)")) {
    return { state: "working" as const, detail: "processing" }
  }

  // Spinner characters (Claude actively working)
  if (/[✶✷✸✹✺✻✼✽]/.test(lastFew) || lastFew.includes("thinking)") || lastFew.includes("· thinking")) {
    return { state: "working" as const, detail: "processing" }
  }

  // User input prompt
  if (/^\s*❯/.test(lastLine) || /^\s*>\s*$/.test(lastLine)) {
    return { state: "waiting" as const, detail: "awaiting input" }
  }

  // Running/processing state
  if (recent.includes("Running") || recent.includes("⏳") || /\.\.\.\s*$/.test(recent)) {
    const toolMatch = recent.match(/(\w+)\(/)
    const tool = toolMatch?.[1]?.toLowerCase() ?? "tool"
    return { state: "working" as const, detail: `running: ${tool}` }
  }

  // PR/commit completion
  if (recent.includes("PR created:") || /https:\/\/github\.com\/[^\s]+\/pull\/\d+/.test(recent)) {
    return { state: "waiting" as const, detail: "PR created" }
  }

  if (recent.includes("commit") && /\b[0-9a-f]{7,40}\b/.test(recent)) {
    return { state: "waiting" as const, detail: "committed" }
  }

  // Error states
  if (recent.includes("Error:") || recent.includes("error:") || recent.includes("failed")) {
    return { state: "error" as const, detail: "error occurred" }
  }

  // Default: idle
  return { state: "idle" as const, detail: undefined }
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
    detectPaneState
  })
}) {}
