import { useCallback } from "react"
import { StatusIndicator, getStatusTextColor } from "./StatusIndicator"
import { ContextBar } from "./ContextBar"
import { type Session, getSessionStatus } from "../types"

interface SessionRowProps {
  session: Session
  onFocus: (name: string) => void
  onOpenEditor: (path: string) => void
}

/**
 * Convert full model name to short display name (Opus, Sonnet, Haiku).
 */
function getShortModelName(model: string | null): string | null {
  if (!model) return null
  const lower = model.toLowerCase()
  if (lower.includes("opus")) return "Opus"
  if (lower.includes("sonnet")) return "Sonnet"
  if (lower.includes("haiku")) return "Haiku"
  // For non-Claude models, return a shortened version
  if (lower.includes("gpt-4")) return "GPT-4"
  if (lower.includes("gpt-3")) return "GPT-3"
  if (lower.includes("llama")) return "Llama"
  if (lower.includes("qwen")) return "Qwen"
  return null
}

export function SessionRow({ session, onFocus, onOpenEditor }: SessionRowProps): JSX.Element {
  const status = getSessionStatus(session.status)

  // Single click opens editor
  const handleClick = useCallback(() => {
    onOpenEditor(session.path)
  }, [onOpenEditor, session.path])

  // Double click focuses terminal
  const handleDoubleClick = useCallback(() => {
    onFocus(session.name)
  }, [onFocus, session.name])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault()
        onOpenEditor(session.path)
      }
    },
    [onOpenEditor, session.path]
  )

  const shortModel = getShortModelName(session.model)

  return (
    <button
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
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
        <div className="flex-1 min-w-0">
          <span className="text-teal-400 font-medium truncate block">
            {session.displayName}
          </span>
          {/* Git branch - always visible when present */}
          {session.gitBranch && (
            <span className="text-gray-500 text-xs truncate block">
              {session.gitBranch}
            </span>
          )}
        </div>
        <span className="text-gray-500 text-xs shrink-0">
          {session.lastActivity}
        </span>
      </div>

      {/* Summary text */}
      <p className="text-gray-400 text-sm truncate mb-2 pl-4">
        {session.summary}
      </p>

      {/* Status detail, model badge, and context bar */}
      <div className="flex items-center gap-2 pl-4">
        {session.statusDetail && (
          <span className={`text-xs ${getStatusTextColor(status)} shrink-0`}>
            {session.statusDetail}
          </span>
        )}
        {shortModel && (
          <span className="text-xs px-1.5 py-0.5 bg-purple-600/30 text-purple-300 rounded shrink-0">
            {shortModel}
          </span>
        )}
        <div className="flex-1">
          <ContextBar percent={session.contextPercent} height="sm" />
        </div>
      </div>
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
