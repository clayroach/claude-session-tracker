import { useCallback } from "react"
import { StatusIndicator, getStatusTextColor } from "./StatusIndicator"
import { ContextBar } from "./ContextBar"
import { type Session, getSessionStatus } from "../types"

interface SessionRowProps {
  session: Session
  onFocus: (name: string) => void
}

export function SessionRow({ session, onFocus }: SessionRowProps): JSX.Element {
  const status = getSessionStatus(session.status)

  const handleClick = useCallback(() => {
    onFocus(session.name)
  }, [onFocus, session.name])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault()
        onFocus(session.name)
      }
    },
    [onFocus, session.name]
  )

  return (
    <button
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className="w-full bg-gray-800 rounded-lg p-3 cursor-pointer hover:bg-gray-700 focus:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition text-left no-drag group"
      aria-label={`Session: ${session.displayName}. Status: ${status}. ${session.summary}`}
    >
      {/* Header row: status indicator + name + last activity */}
      <div className="flex items-center gap-2 mb-1">
        <StatusIndicator
          status={status}
          detail={session.statusDetail}
          size="md"
        />
        <span className="text-teal-400 font-medium flex-1 truncate">
          {session.displayName}
        </span>
        <span className="text-gray-500 text-xs">
          {session.lastActivity}
        </span>
      </div>

      {/* Summary text */}
      <p className="text-gray-400 text-sm truncate mb-2 pl-4">
        {session.summary}
      </p>

      {/* Status detail (if present) and context bar */}
      <div className="flex items-center gap-2 pl-4">
        {session.statusDetail && (
          <span className={`text-xs ${getStatusTextColor(status)} shrink-0`}>
            {session.statusDetail}
          </span>
        )}
        <div className="flex-1">
          <ContextBar percent={session.contextPercent} height="sm" />
        </div>
      </div>

      {/* Git branch indicator (shown on hover) */}
      {session.gitBranch && (
        <div className="mt-2 pl-4 opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="text-gray-500 text-xs">
            <span className="text-gray-600">branch:</span> {session.gitBranch}
          </span>
        </div>
      )}
    </button>
  )
}

/**
 * Empty state component when no sessions are available.
 */
export function EmptyState(): JSX.Element {
  return (
    <div className="text-gray-500 text-center py-8">
      <div className="text-4xl mb-2">🔍</div>
      <p className="text-sm">No active sessions</p>
      <p className="text-xs text-gray-600 mt-1">
        Start a Claude session in tmux to see it here
      </p>
    </div>
  )
}
