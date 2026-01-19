import { describe, test, expect } from "bun:test"
import { Effect, Option } from "effect"
import { NodeContext } from "@effect/platform-node"
import { detectPaneState } from "../../src/main/services/TmuxService"

describe("TmuxService", () => {
  describe("detectPaneState", () => {
    test("returns unknown for empty content", () => {
      const result = detectPaneState(Option.none())
      expect(result.state).toBe("unknown")
      expect(result.detail).toBeUndefined()
    })

    test("returns unknown for whitespace-only content", () => {
      const result = detectPaneState(Option.some("   \n\n   "))
      expect(result.state).toBe("unknown")
    })

    test("detects permission prompt for bash", () => {
      const content = `
Some previous output
Do you want to run this command?
Bash(npm install)
Press Enter to approve, Esc to cancel
      `
      const result = detectPaneState(Option.some(content))
      expect(result.state).toBe("permission")
      expect(result.detail).toBe("approve: bash")
    })

    test("detects permission prompt for file edit", () => {
      const content = `
Do you want to edit this file?
Edit(src/index.ts)
Esc to cancel
      `
      const result = detectPaneState(Option.some(content))
      expect(result.state).toBe("permission")
      expect(result.detail).toBe("approve: file edit")
    })

    test("detects permission prompt for file write", () => {
      const content = `
Do you want to write this file?
Write(src/new-file.ts)
Esc to cancel
      `
      const result = detectPaneState(Option.some(content))
      expect(result.state).toBe("permission")
      expect(result.detail).toBe("approve: file write")
    })

    test("detects permission prompt for task", () => {
      const content = `
Do you want to run this task?
Task(explore)
Esc to cancel
      `
      const result = detectPaneState(Option.some(content))
      expect(result.state).toBe("permission")
      expect(result.detail).toBe("approve: task")
    })

    test("detects waiting state after completion", () => {
      const content = `
Previous work output...
Sautéd for 2m 30s
❯
      `
      const result = detectPaneState(Option.some(content))
      expect(result.state).toBe("waiting")
      expect(result.detail).toBe("awaiting input")
    })

    test("detects waiting state with cost indicator", () => {
      const content = `
Task completed successfully
Cost: $0.0042
❯
      `
      const result = detectPaneState(Option.some(content))
      expect(result.state).toBe("waiting")
      expect(result.detail).toBe("awaiting input")
    })

    test("detects working state with ctrl+c prompt", () => {
      const content = `
Claude is working...
Press ctrl+c to interrupt
Processing (1234 tokens)
      `
      const result = detectPaneState(Option.some(content))
      expect(result.state).toBe("working")
      expect(result.detail).toBe("processing")
    })

    test("detects working state with spinner characters", () => {
      const content = `
Claude thinking...
✶ Working on task
      `
      const result = detectPaneState(Option.some(content))
      expect(result.state).toBe("working")
      expect(result.detail).toBe("processing")
    })

    test("detects waiting state at prompt", () => {
      // The prompt must be at the start of the last line
      const content = `Previous output ended\n❯`
      const result = detectPaneState(Option.some(content))
      expect(result.state).toBe("waiting")
      expect(result.detail).toBe("awaiting input")
    })

    test("detects waiting state after PR creation", () => {
      const content = `
Created PR
PR created: https://github.com/user/repo/pull/123
❯
      `
      const result = detectPaneState(Option.some(content))
      expect(result.state).toBe("waiting")
      expect(result.detail).toBe("PR created")
    })

    test("detects error state", () => {
      // Error detection happens when there's an error message
      // Note: "Running" pattern is checked before error, so avoid it
      const content = `Executing task...\nError: Command failed with exit code 1`
      const result = detectPaneState(Option.some(content))
      expect(result.state).toBe("error")
      expect(result.detail).toBe("error occurred")
    })

    test("returns idle for generic content", () => {
      const content = `
Some random terminal output
that doesn't match any patterns
just normal text
      `
      const result = detectPaneState(Option.some(content))
      expect(result.state).toBe("idle")
      expect(result.detail).toBeUndefined()
    })
  })
})
