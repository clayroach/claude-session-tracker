import { test, expect, _electron as electron } from "@playwright/test"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

test.describe("Electron App", () => {
  test("window opens with correct title", async () => {
    const electronApp = await electron.launch({
      args: [path.join(__dirname, "../dist/main/index.js")],
      env: {
        ...process.env,
        NODE_ENV: "production"
      }
    })

    const window = await electronApp.firstWindow()

    // Wait for the window to be ready
    await window.waitForLoadState("domcontentloaded")

    // Verify the window exists and has content
    const title = await window.title()
    expect(title).toBe("Claude Session Tracker")

    await electronApp.close()
  })

  test("window displays session list UI", async () => {
    const electronApp = await electron.launch({
      args: [path.join(__dirname, "../dist/main/index.js")],
      env: {
        ...process.env,
        NODE_ENV: "production"
      }
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState("domcontentloaded")

    // Wait for React to render
    await window.waitForSelector("h1", { timeout: 5000 })

    // Check for main UI elements
    const header = await window.locator("h1").textContent()
    expect(header).toBe("Claude Sessions")

    // Check for the hotkey hint in footer
    const footer = await window.locator("footer").textContent()
    expect(footer).toContain("⌘⇧C")

    await electronApp.close()
  })

  test("window is always on top", async () => {
    const electronApp = await electron.launch({
      args: [path.join(__dirname, "../dist/main/index.js")],
      env: {
        ...process.env,
        NODE_ENV: "production"
      }
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState("domcontentloaded")

    // Check window properties via evaluate
    const isAlwaysOnTop = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      return win?.isAlwaysOnTop() ?? false
    })

    expect(isAlwaysOnTop).toBe(true)

    await electronApp.close()
  })

  test("window has correct dimensions", async () => {
    const electronApp = await electron.launch({
      args: [path.join(__dirname, "../dist/main/index.js")],
      env: {
        ...process.env,
        NODE_ENV: "production"
      }
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState("domcontentloaded")

    const bounds = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      return win?.getBounds()
    })

    expect(bounds?.width).toBe(380)
    expect(bounds?.height).toBe(900)

    await electronApp.close()
  })
})
