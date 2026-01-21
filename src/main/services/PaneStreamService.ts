import { Stream, Effect, Schedule, Duration, pipe, Option } from "effect"
import { capturePane, parsePaneContent, type PaneState, type PaneToolCall } from "./TmuxService.js"

// ============================================================================
// Types
// ============================================================================

/**
 * Update emitted by the pane stream.
 */
export interface PaneUpdate {
  readonly sessionName: string
  readonly paneState: PaneState
  readonly timestamp: number
}

/**
 * Serializable version for IPC.
 */
export interface SerializedPaneUpdate {
  readonly sessionName: string
  readonly recentCommands: readonly { displayName: string; target: string | null }[]
  readonly currentTodo: string | null
  readonly nextTodo: string | null
  readonly status: { state: string; detail?: string | undefined }
  readonly timestamp: number
}

// ============================================================================
// Stream Implementation
// ============================================================================

/**
 * Capture pane content for a session and parse it.
 */
const capturePaneState = (sessionName: string) =>
  Effect.gen(function* () {
    const content = yield* capturePane(sessionName)
    const paneContent = Option.getOrElse(content, () => "")
    const paneState = parsePaneContent(paneContent)

    return {
      sessionName,
      paneState,
      timestamp: Date.now()
    } satisfies PaneUpdate
  }).pipe(
    // Silently ignore errors (session might have closed)
    Effect.catchAll(() =>
      Effect.succeed({
        sessionName,
        paneState: {
          recentCommands: [] as readonly PaneToolCall[],
          currentTodo: null,
          nextTodo: null,
          status: { state: "unknown" as const }
        },
        timestamp: Date.now()
      } satisfies PaneUpdate)
    )
  )

/**
 * Create a stream that polls pane content for all active sessions.
 * Emits PaneUpdate events every `intervalSeconds` seconds.
 */
export const createPaneStream = (
  getSessionNames: () => readonly string[],
  intervalSeconds: number = 2
) =>
  pipe(
    // Repeatedly poll at the specified interval
    Stream.repeatEffect(
      Effect.gen(function* () {
        const sessionNames = getSessionNames()

        if (sessionNames.length === 0) {
          return [] as PaneUpdate[]
        }

        // Capture all sessions in parallel (max 5 concurrent)
        const updates = yield* Effect.all(
          sessionNames.map(capturePaneState),
          { concurrency: 5 }
        )

        return updates
      })
    ),
    Stream.schedule(Schedule.spaced(Duration.seconds(intervalSeconds))),
    // Flatten array of updates to individual updates
    Stream.flatMap((updates) => Stream.fromIterable(updates))
  )

/**
 * Create a stream with change detection.
 * Only emits when pane state actually changes for a session.
 */
export const createPaneStreamWithChanges = (
  getSessionNames: () => readonly string[],
  intervalSeconds: number = 2
) => {
  // Track last state per session for change detection
  const lastStates = new Map<string, string>()

  return pipe(
    createPaneStream(getSessionNames, intervalSeconds),
    Stream.filter((update) => {
      // Serialize state for comparison
      const stateKey = JSON.stringify({
        recentCommands: update.paneState.recentCommands,
        currentTodo: update.paneState.currentTodo,
        nextTodo: update.paneState.nextTodo,
        status: update.paneState.status
      })

      const lastKey = lastStates.get(update.sessionName)

      if (lastKey === stateKey) {
        // No change
        return false
      }

      // State changed, update cache
      lastStates.set(update.sessionName, stateKey)
      return true
    })
  )
}

/**
 * Serialize PaneUpdate for IPC transport.
 */
export const serializePaneUpdate = (update: PaneUpdate): SerializedPaneUpdate => ({
  sessionName: update.sessionName,
  recentCommands: update.paneState.recentCommands.map(cmd => ({
    displayName: cmd.displayName,
    target: cmd.target
  })),
  currentTodo: update.paneState.currentTodo,
  nextTodo: update.paneState.nextTodo,
  status: update.paneState.status,
  timestamp: update.timestamp
})

/**
 * Run the pane stream and call handler for each update.
 * Returns an Effect that runs forever (until interrupted).
 */
export const runPaneStream = (
  getSessionNames: () => readonly string[],
  onUpdate: (update: SerializedPaneUpdate) => void,
  intervalSeconds: number = 2
) =>
  pipe(
    createPaneStreamWithChanges(getSessionNames, intervalSeconds),
    Stream.runForEach((update) =>
      Effect.sync(() => onUpdate(serializePaneUpdate(update)))
    )
  )
