import { useEffect, useState, useCallback } from "react"
import { SessionRow, EmptyState, Settings } from "./components"
import { type Session } from "./types"

export function App(): JSX.Element {
  const [sessions, setSessions] = useState<Session[]>([])
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  // Load sessions on mount and subscribe to updates
  useEffect(() => {
    const loadSessions = async (): Promise<void> => {
      const data = await window.api.getSessions()
      setSessions(data as Session[])
    }

    void loadSessions()
    window.api.onSessionsUpdate((data) => setSessions(data as Session[]))
  }, [])

  // Manual refresh handler
  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return
    setIsRefreshing(true)
    try {
      await window.api.refresh()
    } finally {
      // Brief delay to show the spinner
      setTimeout(() => setIsRefreshing(false), 500)
    }
  }, [isRefreshing])

  // Focus session handler
  const handleFocusSession = useCallback((name: string) => {
    void window.api.focusSession(name)
  }, [])

  // Settings handlers
  const handleOpenSettings = useCallback(() => {
    setIsSettingsOpen(true)
  }, [])

  const handleCloseSettings = useCallback(() => {
    setIsSettingsOpen(false)
  }, [])

  return (
    <div className="bg-gray-900/95 text-white h-screen flex flex-col rounded-lg border border-gray-700/50">
      {/* Draggable header */}
      <header className="flex justify-between items-center p-4 pb-2 drag">
        <h1 className="text-lg font-semibold">Claude Sessions</h1>
        <div className="flex items-center gap-2 no-drag">
          {/* Settings button */}
          <button
            onClick={handleOpenSettings}
            className="p-1.5 rounded hover:bg-gray-700 transition-colors"
            title="Settings"
            aria-label="Open settings"
          >
            <svg
              className="w-4 h-4 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </button>
          {/* Refresh button */}
          <button
            onClick={() => void handleRefresh()}
            disabled={isRefreshing}
            className="p-1.5 rounded hover:bg-gray-700 transition-colors disabled:opacity-50"
            title="Refresh sessions"
            aria-label="Refresh sessions"
          >
            <svg
              className={`w-4 h-4 text-gray-400 ${isRefreshing ? "animate-spin" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
          {/* Session count badge */}
          <span className="bg-blue-600 px-2 py-0.5 rounded text-sm min-w-[1.5rem] text-center">
            {sessions.length}
          </span>
        </div>
      </header>

      {/* Session list */}
      <main className="flex-1 overflow-y-auto px-4 pb-2 space-y-2">
        {sessions.length === 0 ? (
          <EmptyState />
        ) : (
          sessions.map((session) => (
            <SessionRow
              key={session.name}
              session={session}
              onFocus={handleFocusSession}
            />
          ))
        )}
      </main>

      {/* Footer with keyboard shortcut hint */}
      <footer className="text-gray-500 text-xs p-2 text-center border-t border-gray-800">
        <kbd className="px-1.5 py-0.5 bg-gray-800 rounded text-gray-400">⌘⇧C</kbd>
        <span className="ml-1">to toggle</span>
      </footer>

      {/* Settings modal */}
      <Settings isOpen={isSettingsOpen} onClose={handleCloseSettings} />
    </div>
  )
}
