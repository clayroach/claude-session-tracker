import { app, BrowserWindow, globalShortcut, ipcMain } from "electron"
import { Effect, Layer } from "effect"
import { NodeContext, NodeRuntime } from "@effect/platform-node"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 380,
    height: 900,
    x: 20,
    y: 50,
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

const program = Effect.gen(function* () {
  // Set up IPC handlers
  ipcMain.handle("get-sessions", () => {
    // TODO: Implement with SessionService
    return []
  })

  ipcMain.handle("refresh", () => {
    // TODO: Implement refresh
    return Effect.runPromise(Effect.void)
  })

  ipcMain.handle("focus-session", (_event, _name: string) => {
    // TODO: Implement focus session
    return Effect.runPromise(Effect.void)
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

  // Keep running until app quits
  yield* Effect.async<never, never>(() => {
    app.on("will-quit", () => {
      globalShortcut.unregisterAll()
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
