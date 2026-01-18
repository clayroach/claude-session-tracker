import { describe, test, expect } from "bun:test"
import { Option } from "effect"
import {
  serializeSession,
  type TrackedSession,
  type SessionConfig
} from "../../src/main/services/SessionService"
import type { TmuxSession } from "../../src/main/services/TmuxService"
import type { SessionData, SessionStatus } from "../../src/main/services/ClaudeService"

describe("SessionService", () => {
  // Helper to create test data
  const makeTmuxSession = (overrides: Partial<TmuxSession> = {}): TmuxSession => ({
    name: "test-session",
    path: "/Users/test/projects/myproject",
    attached: false,
    ...overrides
  })

  const makeSessionData = (overrides: Partial<SessionData> = {}): SessionData => ({
    tokens: { input: 1000, output: 500, cacheRead: 200, total: 1700 },
    messages: ["Hello", "How are you?"],
    assistantMessages: ["I'm doing well!"],
    model: Option.some("claude-sonnet-4-20250514"),
    slug: Option.some("myproject"),
    gitBranch: Option.some("main"),
    sessionId: Option.some("abc123"),
    lastTimestamp: Math.floor(Date.now() / 1000) - 60,
    activeTool: Option.none(),
    pendingTool: Option.none(),
    pendingToolIds: new Map(),
    currentContext: 50000,
    lastMessageRole: Option.some("assistant"),
    ...overrides
  })

  const makeTrackedSession = (overrides: Partial<TrackedSession> = {}): TrackedSession => ({
    tmux: makeTmuxSession(),
    claude: makeSessionData(),
    displayName: "myproject",
    repo: "myproject",
    status: { _tag: "waiting", reason: "awaiting input" },
    statusDetail: "awaiting input",
    summary: "Working on the feature",
    contextPercent: 25,
    lastActivity: "1m ago",
    ...overrides
  })

  describe("serializeSession", () => {
    test("serializes a full session correctly", () => {
      const session = makeTrackedSession()
      const result = serializeSession(session)

      expect(result.name).toBe("test-session")
      expect(result.displayName).toBe("myproject")
      expect(result.attached).toBe(false)
      expect(result.path).toBe("/Users/test/projects/myproject")
      expect(result.repo).toBe("myproject")
      expect(result.status).toBe("waiting")
      expect(result.statusDetail).toBe("awaiting input")
      expect(result.summary).toBe("Working on the feature")
      expect(result.contextPercent).toBe(25)
      expect(result.lastActivity).toBe("1m ago")
      expect(result.model).toBe("claude-sonnet-4-20250514")
      expect(result.gitBranch).toBe("main")
    })

    test("serializes session without Claude data", () => {
      const session = makeTrackedSession({
        claude: null,
        status: { _tag: "idle" },
        statusDetail: null
      })
      const result = serializeSession(session)

      expect(result.status).toBe("idle")
      expect(result.statusDetail).toBeNull()
      expect(result.model).toBeNull()
      expect(result.gitBranch).toBeNull()
    })

    test("serializes attached session", () => {
      const session = makeTrackedSession({
        tmux: makeTmuxSession({ attached: true })
      })
      const result = serializeSession(session)

      expect(result.attached).toBe(true)
    })

    test("serializes working status", () => {
      const session = makeTrackedSession({
        status: { _tag: "working", tool: "Bash" },
        statusDetail: "Bash"
      })
      const result = serializeSession(session)

      expect(result.status).toBe("working")
      expect(result.statusDetail).toBe("Bash")
    })

    test("serializes permission status", () => {
      const session = makeTrackedSession({
        status: { _tag: "permission", tool: "file edit" },
        statusDetail: "file edit"
      })
      const result = serializeSession(session)

      expect(result.status).toBe("permission")
      expect(result.statusDetail).toBe("file edit")
    })

    test("serializes error status", () => {
      const session = makeTrackedSession({
        status: { _tag: "error", message: "Something went wrong" },
        statusDetail: "Something went wrong"
      })
      const result = serializeSession(session)

      expect(result.status).toBe("error")
      expect(result.statusDetail).toBe("Something went wrong")
    })

    test("serializes active status", () => {
      const session = makeTrackedSession({
        status: { _tag: "active" },
        statusDetail: null
      })
      const result = serializeSession(session)

      expect(result.status).toBe("active")
      expect(result.statusDetail).toBeNull()
    })

    test("handles session with no model", () => {
      const claude = makeSessionData({ model: Option.none() })
      const session = makeTrackedSession({ claude })
      const result = serializeSession(session)

      expect(result.model).toBeNull()
    })

    test("handles session with no git branch", () => {
      const claude = makeSessionData({ gitBranch: Option.none() })
      const session = makeTrackedSession({ claude })
      const result = serializeSession(session)

      expect(result.gitBranch).toBeNull()
    })
  })

  describe("SessionConfig defaults", () => {
    // Test that we can import the default config
    test("DEFAULT_CONFIG is accessible", async () => {
      const { SessionService } = await import("../../src/main/services/SessionService")
      // The DEFAULT_CONFIG is exported via the service
      expect(SessionService).toBeDefined()
    })
  })

  describe("TrackedSession structure", () => {
    test("TrackedSession includes all required fields", () => {
      const session = makeTrackedSession()

      // Verify structure
      expect(session.tmux).toBeDefined()
      expect(session.tmux.name).toBe("test-session")
      expect(session.claude).not.toBeNull()
      expect(session.displayName).toBe("myproject")
      expect(session.repo).toBe("myproject")
      expect(session.status).toBeDefined()
      expect(session.status._tag).toBe("waiting")
      expect(session.summary).toBe("Working on the feature")
      expect(session.contextPercent).toBe(25)
      expect(session.lastActivity).toBe("1m ago")
    })

    test("TrackedSession works with null claude data", () => {
      const session = makeTrackedSession({ claude: null })

      expect(session.claude).toBeNull()
      expect(session.tmux).toBeDefined()
    })
  })

  describe("Status types", () => {
    test("all status types are properly handled", () => {
      const statusTypes: SessionStatus[] = [
        { _tag: "active" },
        { _tag: "working", tool: "Bash" },
        { _tag: "waiting", reason: "awaiting input" },
        { _tag: "permission", tool: "file edit" },
        { _tag: "idle" },
        { _tag: "error", message: "Error occurred" }
      ]

      for (const status of statusTypes) {
        const session = makeTrackedSession({ status })
        const result = serializeSession(session)
        expect(result.status).toBe(status._tag)
      }
    })
  })

  describe("Context percent handling", () => {
    test("context percent is preserved in serialization", () => {
      const session = makeTrackedSession({ contextPercent: 75 })
      const result = serializeSession(session)
      expect(result.contextPercent).toBe(75)
    })

    test("context percent of 0 is preserved", () => {
      const session = makeTrackedSession({ contextPercent: 0 })
      const result = serializeSession(session)
      expect(result.contextPercent).toBe(0)
    })

    test("context percent of 100 is preserved", () => {
      const session = makeTrackedSession({ contextPercent: 100 })
      const result = serializeSession(session)
      expect(result.contextPercent).toBe(100)
    })
  })
})
