import { describe, test, expect } from "bun:test"
import { Option } from "effect"
import {
  pathToClaudeProject,
  parseTimestamp,
  timeAgo,
  calculateContextPercent,
  determineStatus,
  generateSummary,
  type SessionData
} from "../../src/main/services/ClaudeService"

describe("ClaudeService", () => {
  describe("pathToClaudeProject", () => {
    test("converts path with leading slash", () => {
      expect(pathToClaudeProject("/Users/foo/projects/bar")).toBe("-Users-foo-projects-bar")
    })

    test("handles trailing slash", () => {
      expect(pathToClaudeProject("/Users/foo/bar/")).toBe("-Users-foo-bar")
    })

    test("handles path without leading slash", () => {
      expect(pathToClaudeProject("foo/bar")).toBe("foo-bar")
    })

    test("handles single segment", () => {
      expect(pathToClaudeProject("/foo")).toBe("-foo")
    })
  })

  describe("parseTimestamp", () => {
    test("parses ISO 8601 timestamp", () => {
      // Note: This test depends on timezone, but we're testing the parsing logic
      const result = parseTimestamp("2026-01-15T20:52:55.836Z")
      expect(result).toBeGreaterThan(0)
    })

    test("returns 0 for invalid timestamp", () => {
      expect(parseTimestamp("invalid")).toBe(0)
    })

    test("returns 0 for empty string", () => {
      expect(parseTimestamp("")).toBe(0)
    })
  })

  describe("timeAgo", () => {
    test("returns 'now' for < 60 seconds", () => {
      expect(timeAgo(0)).toBe("now")
      expect(timeAgo(30)).toBe("now")
      expect(timeAgo(59)).toBe("now")
    })

    test("returns minutes ago for < 1 hour", () => {
      expect(timeAgo(60)).toBe("1m ago")
      expect(timeAgo(120)).toBe("2m ago")
      expect(timeAgo(3599)).toBe("59m ago")
    })

    test("returns hours ago for < 1 day", () => {
      expect(timeAgo(3600)).toBe("1h ago")
      expect(timeAgo(7200)).toBe("2h ago")
      expect(timeAgo(86399)).toBe("23h ago")
    })

    test("returns days ago for >= 1 day", () => {
      expect(timeAgo(86400)).toBe("1d ago")
      expect(timeAgo(172800)).toBe("2d ago")
    })

    test("returns 'unknown' for negative values", () => {
      expect(timeAgo(-1)).toBe("unknown")
    })
  })

  describe("calculateContextPercent", () => {
    const makeSessionData = (currentContext: number, model: Option.Option<string>): SessionData => ({
      tokens: { input: 0, output: 0, cacheRead: 0, total: 0 },
      messages: [],
      assistantMessages: [],
      model,
      slug: Option.none(),
      gitBranch: Option.none(),
      sessionId: Option.none(),
      lastTimestamp: 0,
      activeTool: Option.none(),
      pendingTool: Option.none(),
      pendingToolIds: new Map(),
      currentContext,
      lastMessageRole: Option.none()
    })

    test("calculates percentage for default model", () => {
      const data = makeSessionData(100000, Option.none())
      expect(calculateContextPercent(data, Option.none())).toBe(50) // 100k / 200k
    })

    test("calculates percentage for Opus model", () => {
      const data = makeSessionData(100000, Option.some("claude-opus-4-5-20251101"))
      expect(calculateContextPercent(data, Option.some("claude-opus-4-5-20251101"))).toBe(50)
    })

    test("calculates percentage for Sonnet with extended context", () => {
      const data = makeSessionData(500000, Option.some("claude-sonnet-4-20250514"))
      // 500k / 1M = 50%
      expect(calculateContextPercent(data, Option.some("claude-sonnet-4-20250514"))).toBe(50)
    })

    test("switches to extended context when usage exceeds base", () => {
      // If context used > 200k, assume extended (1M)
      const data = makeSessionData(300000, Option.none())
      expect(calculateContextPercent(data, Option.none())).toBe(30) // 300k / 1M
    })

    test("caps at 100%", () => {
      const data = makeSessionData(2000000, Option.none())
      expect(calculateContextPercent(data, Option.none())).toBe(100)
    })

    test("returns 0 for no context usage", () => {
      const data = makeSessionData(0, Option.none())
      expect(calculateContextPercent(data, Option.none())).toBe(0)
    })
  })

  describe("determineStatus", () => {
    const makeSessionData = (
      overrides: Partial<SessionData> = {}
    ): SessionData => ({
      tokens: { input: 0, output: 0, cacheRead: 0, total: 0 },
      messages: [],
      assistantMessages: [],
      model: Option.none(),
      slug: Option.none(),
      gitBranch: Option.none(),
      sessionId: Option.none(),
      lastTimestamp: 0,
      activeTool: Option.none(),
      pendingTool: Option.none(),
      pendingToolIds: new Map(),
      currentContext: 0,
      lastMessageRole: Option.none(),
      ...overrides
    })

    test("returns permission status for pending Bash tool", () => {
      const data = makeSessionData({ pendingTool: Option.some("Bash") })
      const status = determineStatus(data, false, 60)
      expect(status._tag).toBe("permission")
      if (status._tag === "permission") {
        expect(status.tool).toBe("bash")
      }
    })

    test("returns permission status for pending Edit tool", () => {
      const data = makeSessionData({ pendingTool: Option.some("Edit") })
      const status = determineStatus(data, false, 60)
      expect(status._tag).toBe("permission")
      if (status._tag === "permission") {
        expect(status.tool).toBe("file edit")
      }
    })

    test("ignores pending tool after 10 minutes", () => {
      const data = makeSessionData({ pendingTool: Option.some("Bash") })
      const status = determineStatus(data, false, 601)
      expect(status._tag).not.toBe("permission")
    })

    test("returns working status for active tool", () => {
      const data = makeSessionData({ activeTool: Option.some("Read") })
      const status = determineStatus(data, false, 60)
      expect(status._tag).toBe("working")
      if (status._tag === "working") {
        expect(status.tool).toBe("read")
      }
    })

    test("ignores active tool after 2 minutes", () => {
      const data = makeSessionData({ activeTool: Option.some("Read") })
      const status = determineStatus(data, false, 121)
      expect(status._tag).not.toBe("working")
    })

    test("returns waiting for assistant message", () => {
      const data = makeSessionData({ lastMessageRole: Option.some("assistant" as const) })
      const status = determineStatus(data, false, 60)
      expect(status._tag).toBe("waiting")
      if (status._tag === "waiting") {
        expect(status.reason).toBe("awaiting input")
      }
    })

    test("returns active for attached recent session", () => {
      const data = makeSessionData()
      const status = determineStatus(data, true, 60)
      expect(status._tag).toBe("active")
    })

    test("returns idle by default", () => {
      const data = makeSessionData()
      const status = determineStatus(data, false, 600)
      expect(status._tag).toBe("idle")
    })
  })

  describe("generateSummary", () => {
    test("returns last user message", () => {
      const messages = ["First message", "Second message", "Last message"]
      const summary = generateSummary(messages, [], 120)
      expect(summary).toBe("Last message")
    })

    test("skips system messages starting with <", () => {
      const messages = ["Real message", "<system-reminder>internal</system-reminder>"]
      const summary = generateSummary(messages, [], 120)
      expect(summary).toBe("Real message")
    })

    test("skips slash commands", () => {
      const messages = ["Real message", "/clear"]
      const summary = generateSummary(messages, [], 120)
      expect(summary).toBe("Real message")
    })

    test("falls back to assistant message", () => {
      const messages: string[] = []
      const assistantMessages = ["Claude's response"]
      const summary = generateSummary(messages, assistantMessages, 120)
      expect(summary).toBe("Claude's response")
    })

    test("returns 'No recent activity' when no messages", () => {
      const summary = generateSummary([], [], 120)
      expect(summary).toBe("No recent activity")
    })

    test("truncates long messages", () => {
      const longMessage = "A".repeat(200)
      const summary = generateSummary([longMessage], [], 50)
      expect(summary.length).toBe(50)
      expect(summary.endsWith("...")).toBe(true)
    })

    test("cleans whitespace from messages", () => {
      const messages = ["Message\nwith\nnewlines   and   spaces"]
      const summary = generateSummary(messages, [], 120)
      expect(summary).toBe("Message with newlines and spaces")
    })
  })
})
