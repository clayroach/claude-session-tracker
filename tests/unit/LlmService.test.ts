import { describe, test, expect } from "bun:test"
import { Option } from "effect"
import { condenseEntries, parseAnalysisResponse } from "../../src/main/services/LlmService"

describe("LlmService", () => {
  describe("condenseEntries", () => {

    test("returns empty array for empty input", () => {
      const result = condenseEntries([])
      expect(result).toEqual([])
    })

    test("skips non-object entries", () => {
      const result = condenseEntries([null, undefined, "string", 123])
      expect(result).toEqual([])
    })

    test("extracts user text content", () => {
      const entries = [{
        type: "user",
        timestamp: "2026-01-15T20:52:55.836Z",
        message: { content: "Hello, Claude" }
      }]
      const result = condenseEntries(entries)
      expect(result.length).toBe(1)
      expect(result[0]?.type).toBe("user")
      expect(result[0]?.timestamp).toBe("2026-01-15T20:52:55.836Z")
      expect(result[0]?.content).toBe("Hello, Claude")
    })

    test("extracts user text from array content", () => {
      const entries = [{
        type: "user",
        message: {
          content: [
            { type: "text", text: "User message text" }
          ]
        }
      }]
      const result = condenseEntries(entries)
      expect(result[0]?.content).toBe("User message text")
    })

    test("extracts tool_result from user messages", () => {
      const entries = [{
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "tool-123" }
          ]
        }
      }]
      const result = condenseEntries(entries)
      expect(result[0]?.toolResult).toBe("tool-123")
    })

    test("extracts assistant text content", () => {
      const entries = [{
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Claude's response text" }
          ]
        }
      }]
      const result = condenseEntries(entries)
      expect(result[0]?.content).toBe("Claude's response text")
    })

    test("extracts tool_use from assistant messages", () => {
      const entries = [{
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "Bash", input: { command: "npm install" } }
          ]
        }
      }]
      const result = condenseEntries(entries)
      expect(result[0]?.tool).toBe("Bash")
      expect(result[0]?.toolInput).toBe("npm install")
    })

    test("extracts file_path from tool input", () => {
      const entries = [{
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "Edit", input: { file_path: "/src/index.ts" } }
          ]
        }
      }]
      const result = condenseEntries(entries)
      expect(result[0]?.tool).toBe("Edit")
      expect(result[0]?.toolInput).toBe("/src/index.ts")
    })

    test("truncates long content", () => {
      const longText = "A".repeat(500)
      const entries = [{
        type: "user",
        message: { content: longText }
      }]
      const result = condenseEntries(entries)
      expect(result[0]?.content?.length).toBe(200)
    })

    test("truncates long command", () => {
      const longCommand = "npm run " + "A".repeat(100)
      const entries = [{
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "Bash", input: { command: longCommand } }
          ]
        }
      }]
      const result = condenseEntries(entries)
      expect(result[0]?.toolInput?.length).toBe(50)
    })
  })

  describe("parseAnalysisResponse", () => {
    test("parses valid JSON response", () => {
      const response = '{"state": "working", "detail": "processing", "summary": "Working on task"}'
      const result = parseAnalysisResponse(response)
      expect(Option.isSome(result)).toBe(true)
      if (Option.isSome(result)) {
        expect(result.value.state).toBe("working")
        expect(result.value.detail).toBe("processing")
        expect(result.value.summary).toBe("Working on task")
      }
    })

    test("handles JSON wrapped in markdown code blocks", () => {
      const response = '```json\n{"state": "idle"}\n```'
      const result = parseAnalysisResponse(response)
      expect(Option.isSome(result)).toBe(true)
      if (Option.isSome(result)) {
        expect(result.value.state).toBe("idle")
      }
    })

    test("handles response with thinking tags", () => {
      const response = '<think>Let me analyze this...</think>{"state": "waiting", "detail": "awaiting input"}'
      const result = parseAnalysisResponse(response)
      expect(Option.isSome(result)).toBe(true)
      if (Option.isSome(result)) {
        expect(result.value.state).toBe("waiting")
      }
    })

    test("extracts JSON from mixed content", () => {
      const response = 'Some preamble text {"state": "permission", "detail": "bash"} trailing text'
      const result = parseAnalysisResponse(response)
      expect(Option.isSome(result)).toBe(true)
      if (Option.isSome(result)) {
        expect(result.value.state).toBe("permission")
      }
    })

    test("returns none for invalid JSON", () => {
      const response = 'This is not JSON at all'
      const result = parseAnalysisResponse(response)
      expect(Option.isNone(result)).toBe(true)
    })

    test("returns none for missing required state field", () => {
      const response = '{"detail": "processing", "summary": "Some work"}'
      const result = parseAnalysisResponse(response)
      expect(Option.isNone(result)).toBe(true)
    })

    test("returns none for invalid state value", () => {
      const response = '{"state": "invalid_state"}'
      const result = parseAnalysisResponse(response)
      expect(Option.isNone(result)).toBe(true)
    })

    test("handles response with only state", () => {
      const response = '{"state": "idle"}'
      const result = parseAnalysisResponse(response)
      expect(Option.isSome(result)).toBe(true)
      if (Option.isSome(result)) {
        expect(result.value.state).toBe("idle")
        expect(result.value.detail).toBeUndefined()
        expect(result.value.summary).toBeUndefined()
      }
    })
  })
})
