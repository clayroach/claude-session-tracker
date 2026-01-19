import { useCallback } from "react"
import { StatusIndicator, getStatusTextColor } from "./StatusIndicator"
import { ContextBar } from "./ContextBar"
import { type Session, getSessionStatus } from "../types"

interface SessionRowProps {
  session: Session
  onFocus: (name: string) => void
  onOpenEditor: (path: string) => void
  onToggleHide?: (name: string) => void
  isHidden?: boolean
  lruPosition?: number // 1-based LRU position, 0 = not in history
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

/**
 * Get model badge styling based on model type.
 */
function getModelBadgeStyle(model: string | null): { bg: string; text: string } {
  if (!model) return { bg: "bg-gray-600/30", text: "text-gray-400" }
  const lower = model.toLowerCase()
  if (lower.includes("opus")) return { bg: "bg-orange-500/20", text: "text-orange-300" }
  if (lower.includes("sonnet")) return { bg: "bg-blue-500/20", text: "text-blue-300" }
  if (lower.includes("haiku")) return { bg: "bg-emerald-500/20", text: "text-emerald-300" }
  return { bg: "bg-purple-600/30", text: "text-purple-300" }
}

/**
 * Convert full model name to single letter for compact view.
 */
function getModelLetter(model: string | null): string | null {
  if (!model) return null
  const lower = model.toLowerCase()
  if (lower.includes("opus")) return "O"
  if (lower.includes("sonnet")) return "S"
  if (lower.includes("haiku")) return "H"
  if (lower.includes("gpt-4")) return "4"
  if (lower.includes("gpt-3")) return "3"
  if (lower.includes("llama")) return "L"
  if (lower.includes("qwen")) return "Q"
  return null
}

export function SessionRow({ session, onFocus, onOpenEditor, onToggleHide, isHidden, lruPosition }: SessionRowProps): JSX.Element {
  const status = getSessionStatus(session.status)

  // Single click opens editor
  const handleClick = useCallback(() => {
    console.log("[SessionRow] single click - opening editor:", session.path)
    onOpenEditor(session.path)
  }, [onOpenEditor, session.path])

  // Double click focuses terminal
  const handleDoubleClick = useCallback(() => {
    console.log("[SessionRow] double click - focusing:", session.name)
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

  const handleHide = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onToggleHide?.(session.name)
  }, [onToggleHide, session.name])

  const shortModel = getShortModelName(session.model)
  const modelStyle = getModelBadgeStyle(session.model)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      className={`w-full bg-gray-800 rounded-lg px-2 py-1.5 cursor-pointer hover:bg-gray-700 focus:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition text-left no-drag group ${isHidden ? "opacity-50" : ""}`}
      aria-label={`Session: ${session.displayName}. Status: ${status}. ${session.summary}`}
    >
      {/* Row 1: Status + Name + Time + Hide */}
      <div className="flex items-center gap-2">
        <StatusIndicator status={status} detail={session.statusDetail} size="md" />
        {/* Status label shown when there's a notable status */}
        {(status === "working" || status === "waiting" || status === "permission") && (
          <span className={`text-xs font-medium shrink-0 ${getStatusTextColor(status)}`}>
            {session.statusDetail || (status === "working" ? "processing" : status === "waiting" ? "awaiting input" : "permission needed")}
          </span>
        )}
        <span className="text-teal-400 font-semibold text-sm truncate flex-1 min-w-0">
          {session.displayName}
        </span>
        {lruPosition !== undefined && lruPosition > 0 && (
          <span className="text-gray-600 text-xs w-4 h-4 flex items-center justify-center bg-gray-700/50 rounded shrink-0" title={`Recently used #${lruPosition}`}>
            {lruPosition}
          </span>
        )}
        <span className="text-gray-600 text-xs shrink-0">{session.lastActivity}</span>
        {onToggleHide && (
          <button
            onClick={handleHide}
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-600 transition-opacity"
            title={isHidden ? "Unhide" : "Hide"}
            aria-label={isHidden ? "Unhide session" : "Hide session"}
          >
            <svg className="w-3 h-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {isHidden ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
              )}
            </svg>
          </button>
        )}
      </div>

      {/* Row 2: Summary (3-4 lines, smaller text) */}
      <p className="text-gray-400 text-[11px] mt-1 ml-5 line-clamp-4 leading-snug">
        {session.summary}
      </p>

      {/* Row 3: Context bar + Model badge */}
      <div className="flex items-center gap-2 mt-1 ml-5">
        <div className="flex-1">
          <ContextBar percent={session.contextPercent} height="sm" />
        </div>
        {shortModel && (
          <span className={`text-[10px] px-1.5 py-0.5 ${modelStyle.bg} ${modelStyle.text} rounded font-medium shrink-0`}>
            {shortModel}
          </span>
        )}
      </div>

      {/* Row 4: Git branch (below progress bar) */}
      {session.gitBranch && (
        <div className="mt-1 ml-5">
          <span className="text-purple-400 text-[11px] font-medium">{session.gitBranch}</span>
        </div>
      )}
    </div>
  )
}

/**
 * Compact version of SessionRow - single line with essential info.
 */
export function SessionRowCompact({ session, onFocus, onOpenEditor, onToggleHide, isHidden, lruPosition }: SessionRowProps): JSX.Element {
  const status = getSessionStatus(session.status)

  const handleClick = useCallback(() => {
    onOpenEditor(session.path)
  }, [onOpenEditor, session.path])

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

  const handleHide = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onToggleHide?.(session.name)
  }, [onToggleHide, session.name])

  const modelLetter = getModelLetter(session.model)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      className={`w-full bg-gray-800 rounded px-2 py-1.5 cursor-pointer hover:bg-gray-700 focus:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition text-left no-drag group ${isHidden ? "opacity-50" : ""}`}
      aria-label={`Session: ${session.displayName}. Status: ${status}.`}
    >
      <div className="flex items-center gap-1.5">
        <StatusIndicator status={status} detail={session.statusDetail} size="sm" />
        {lruPosition !== undefined && lruPosition > 0 && (
          <span className="text-gray-600 text-xs w-3.5 h-3.5 flex items-center justify-center bg-gray-700/50 rounded shrink-0 text-[10px]" title={`#${lruPosition}`}>
            {lruPosition}
          </span>
        )}
        <span className="text-teal-400 text-sm font-medium truncate min-w-0" style={{ flex: "1 1 auto" }}>
          {session.displayName}
        </span>
        {session.gitBranch && (
          <span className="text-gray-500 text-xs truncate" style={{ flex: "0 1 auto", maxWidth: "120px" }}>
            {session.gitBranch}
          </span>
        )}
        {modelLetter && (
          <span className="text-xs w-4 h-4 flex items-center justify-center bg-purple-600/30 text-purple-300 rounded shrink-0">
            {modelLetter}
          </span>
        )}
        <div className="w-10 shrink-0">
          <ContextBar percent={session.contextPercent} height="xs" showLabel={false} />
        </div>
        <span className="text-gray-500 text-xs shrink-0">
          {session.lastActivity}
        </span>
        {/* Hide button - visible on hover */}
        {onToggleHide && (
          <button
            onClick={handleHide}
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-600 transition-opacity"
            title={isHidden ? "Unhide" : "Hide"}
            aria-label={isHidden ? "Unhide session" : "Hide session"}
          >
            <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {isHidden ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
              )}
            </svg>
          </button>
        )}
      </div>
    </div>
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
