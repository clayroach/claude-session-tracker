import { app, BrowserWindow, globalShortcut, ipcMain } from "electron"
import { Effect, Layer, Fiber, Schedule, Duration, pipe, ManagedRuntime } from "effect"
import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Command } from "@effect/platform"
import path from "path"
import { fileURLToPath } from "url"
import {
  refreshSessions,
  serializeSession,
  type SessionConfig,
  type SerializedSession
} from "./services/SessionService.js"
import {
  loadSettings,
  saveSettings,
  toLlmConfig,
  PROVIDER_PRESETS,
  DEFAULT_SETTINGS,
  type AppSettings,
  type LlmSettings
} from "./services/SettingsStore.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null

// ============================================================================
// State
// ============================================================================

// Current sessions state (managed outside Effect for IPC access)
let currentSessions: ReadonlyArray<SerializedSession> = []
let pollingFiber: Fiber.RuntimeFiber<unknown, unknown> | null = null

// Current settings (loaded on startup)
let currentSettings: AppSettings = DEFAULT_SETTINGS

// Managed runtime for IPC handlers
const runtime = ManagedRuntime.make(NodeContext.layer)

// ============================================================================
// Session Configuration
// ============================================================================

/**
 * Build SessionConfig from current settings.
 */
const getSessionConfig = (): SessionConfig => {
  const config: SessionConfig = {
    sessionPattern: currentSettings.session.sessionPattern,
    maxSessionAgeHours: currentSettings.session.maxSessionAgeHours,
    pollIntervalMs: currentSettings.session.pollIntervalMs
  }

  // Only add LLM config if provider is configured
  if (currentSettings.llm.provider) {
    const llmConfig = toLlmConfig(currentSettings.llm)
    // Check if API key is required but missing
    const preset = PROVIDER_PRESETS[currentSettings.llm.provider]
    if (!preset.requiresApiKey || currentSettings.llm.apiKey) {
      (config as { llmConfig?: typeof llmConfig }).llmConfig = llmConfig
    }
  }

  return config
}

// ============================================================================
// Window Management
// ============================================================================

function createWindow(): void {
  // Use saved window position/size if available
  const windowSettings = currentSettings.window

  mainWindow = new BrowserWindow({
    width: windowSettings?.width ?? 380,
    height: windowSettings?.height ?? 900,
    x: windowSettings?.x ?? 20,
    y: windowSettings?.y ?? 50,
    alwaysOnTop: true,
    frame: false,
    transparent: true,
    resizable: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.setAlwaysOnTop(true, "floating")
  mainWindow.setVisibleOnAllWorkspaces(true)

  if (process.env["NODE_ENV"] === "development") {
    mainWindow.loadURL("http://localhost:5174")
    mainWindow.webContents.openDevTools({ mode: "detach" })
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"))
  }

  mainWindow.on("closed", () => {
    mainWindow = null
  })
}

// ============================================================================
// Session Management Effects
// ============================================================================

/**
 * Refresh sessions and update global state.
 */
const doRefresh = Effect.gen(function* () {
  const config = getSessionConfig()
  const sessions = yield* refreshSessions(config)
  const serialized = sessions.map(serializeSession)
  currentSessions = serialized

  // Push update to renderer if window exists
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("sessions-update", serialized)
  }

  yield* Effect.log(`Refreshed ${sessions.length} sessions`)
  return serialized
})

/**
 * Start the polling scheduler.
 */
const startPolling = Effect.gen(function* () {
  // Stop existing polling if running
  if (pollingFiber) {
    yield* Fiber.interrupt(pollingFiber)
    pollingFiber = null
  }

  // Initial refresh
  yield* doRefresh

  // Set up polling
  const pollInterval = currentSettings.session.pollIntervalMs
  const polling = pipe(
    doRefresh,
    Effect.catchAll((error) =>
      Effect.log(`Refresh error: ${String(error)}`)
    ),
    Effect.repeat(Schedule.fixed(Duration.millis(pollInterval)))
  )

  // Fork polling to run in background
  const fiber = yield* Effect.fork(polling)
  pollingFiber = fiber

  yield* Effect.log(`Started polling every ${pollInterval}ms`)
})

/**
 * Focus a tmux session by activating the terminal app.
 */
const focusSession = (sessionName: string) =>
  Effect.gen(function* () {
    if (process.platform === "darwin") {
      const script = `
        tell application "System Events"
          set termApps to {"Terminal", "iTerm", "Alacritty", "kitty"}
          repeat with appName in termApps
            if exists (application process appName) then
              tell application appName to activate
              return appName
            end if
          end repeat
        end tell
      `

      yield* pipe(
        Command.make("osascript", "-e", script),
        Command.string,
        Effect.catchAll(() => Effect.succeed(""))
      )
    }

    yield* Effect.log(`Focus requested for session: ${sessionName}`)
  })

// ============================================================================
// Settings Effects
// ============================================================================

/**
 * Load settings from disk.
 */
const doLoadSettings = Effect.gen(function* () {
  currentSettings = yield* loadSettings
  yield* Effect.log(`Loaded settings: provider=${currentSettings.llm.provider}`)
  return currentSettings
})

/**
 * Save settings and restart polling with new config.
 */
const doSaveSettings = (settings: AppSettings) =>
  Effect.gen(function* () {
    currentSettings = yield* saveSettings(settings)
    yield* Effect.log(`Saved settings: provider=${currentSettings.llm.provider}`)

    // Restart polling with new settings
    yield* startPolling

    // Notify renderer of settings change
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("settings-update", currentSettings)
    }

    return currentSettings
  })

// ============================================================================
// Main Program
// ============================================================================

const program = Effect.gen(function* () {
  // Load settings on startup
  yield* doLoadSettings

  // Set up session IPC handlers
  ipcMain.handle("get-sessions", () => {
    return currentSessions
  })

  ipcMain.handle("refresh", async () => {
    try {
      await runtime.runPromise(doRefresh)
    } catch (error) {
      console.error("Refresh error:", error)
    }
  })

  ipcMain.handle("focus-session", async (_event, name: string) => {
    try {
      await runtime.runPromise(focusSession(name))
    } catch (error) {
      console.error("Focus error:", error)
    }
  })

  // Set up settings IPC handlers
  ipcMain.handle("get-settings", () => {
    return currentSettings
  })

  ipcMain.handle("get-provider-presets", () => {
    return PROVIDER_PRESETS
  })

  ipcMain.handle("save-settings", async (_event, settings: AppSettings) => {
    try {
      return await runtime.runPromise(doSaveSettings(settings))
    } catch (error) {
      console.error("Save settings error:", error)
      throw error
    }
  })

  ipcMain.handle("update-llm-settings", async (_event, llmSettings: LlmSettings) => {
    try {
      const updated: AppSettings = {
        ...currentSettings,
        llm: llmSettings
      }
      return await runtime.runPromise(doSaveSettings(updated))
    } catch (error) {
      console.error("Update LLM settings error:", error)
      throw error
    }
  })

  // Register global shortcut when app is ready
  app.whenReady().then(() => {
    createWindow()

    globalShortcut.register("CommandOrControl+Shift+C", () => {
      if (mainWindow === null) {
        createWindow()
      } else if (mainWindow.isVisible()) {
        mainWindow.hide()
      } else {
        mainWindow.show()
      }
    })

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })

  // Start polling after a short delay to let window initialize
  yield* Effect.sleep(Duration.millis(500))
  yield* startPolling

  // Keep running until app quits
  yield* Effect.async<never, never>(() => {
    app.on("will-quit", () => {
      globalShortcut.unregisterAll()
      if (pollingFiber) {
        Effect.runFork(Fiber.interrupt(pollingFiber))
      }
    })

    app.on("window-all-closed", () => {
      if (process.platform !== "darwin") {
        app.quit()
      }
    })
  })
})

const MainLive = Layer.empty.pipe(Layer.provideMerge(NodeContext.layer))

NodeRuntime.runMain(program.pipe(Effect.provide(MainLive)))
