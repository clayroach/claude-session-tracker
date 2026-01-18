import { useEffect, useState } from "react"

interface Session {
  name: string
  displayName: string
  status: string
  summary: string
  contextPercent: number
}

export function App(): JSX.Element {
  const [sessions, setSessions] = useState<Session[]>([])

  useEffect(() => {
    const loadSessions = async (): Promise<void> => {
      const data = await window.api.getSessions()
      setSessions(data as Session[])
    }

    void loadSessions()
    window.api.onSessionsUpdate((data) => setSessions(data as Session[]))

    const interval = setInterval(() => {
      void window.api.refresh()
    }, 30000)

    return () => clearInterval(interval)
  }, [])

  return (
    <div className="bg-gray-900/95 text-white h-screen p-4 rounded-lg border border-gray-700/50">
      <header className="flex justify-between items-center mb-4">
        <h1 className="text-lg font-semibold">Claude Sessions</h1>
        <span className="bg-blue-600 px-2 py-0.5 rounded text-sm">
          {sessions.length}
        </span>
      </header>

      <main className="space-y-2 overflow-y-auto max-h-[calc(100vh-120px)]">
        {sessions.length === 0 ? (
          <div className="text-gray-500 text-center py-8">
            No active sessions
          </div>
        ) : (
          sessions.map((session) => (
            <button
              key={session.name}
              onClick={() => void window.api.focusSession(session.name)}
              className="w-full bg-gray-800 rounded-lg p-3 cursor-pointer hover:bg-gray-700 transition text-left no-drag"
            >
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 rounded-full bg-gray-500" />
                <span className="text-teal-400 font-medium">
                  {session.displayName}
                </span>
              </div>
              <p className="text-gray-400 text-sm truncate mb-2">
                {session.summary}
              </p>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 transition-all"
                    style={{ width: `${Math.min(session.contextPercent, 100)}%` }}
                  />
                </div>
                <span className="text-gray-500 text-xs">
                  {session.contextPercent}%
                </span>
              </div>
            </button>
          ))
        )}
      </main>

      <footer className="text-gray-500 text-xs mt-4 text-center">
        ⌘⇧C to toggle
      </footer>
    </div>
  )
}
