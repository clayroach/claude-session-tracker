import { useState, useEffect, useCallback, useMemo } from "react"
import { type Session } from "../types"

interface UsageHistoryEntry {
  date: string
  utilization: number
  dailyUsage: number | null
  timestamp: number
}

interface DayData {
  date: string
  dailyUsage: number | null
  utilization: number | null
  hasData: boolean
}

interface SessionTokenData {
  name: string
  displayName: string
  tokens: number
  percentage: number
}

interface UsageChartProps {
  isOpen: boolean
  onClose: () => void
}

/**
 * Format date as short weekday (Mon, Tue, etc.)
 */
function formatDayLabel(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00") // Add time to avoid timezone issues
  return date.toLocaleDateString("en-US", { weekday: "short" })
}

/**
 * Format date as MM/DD
 */
function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00")
  return `${date.getMonth() + 1}/${date.getDate()}`
}

/**
 * Get YYYY-MM-DD string for a date
 */
function formatDateKey(date: Date): string {
  return date.toISOString().split("T")[0] ?? ""
}

/**
 * Get color for daily usage bar based on percentage.
 */
function getBarColor(dailyUsage: number | null, hasData: boolean): string {
  if (!hasData) return "bg-gray-700"
  if (dailyUsage === null || dailyUsage === 0) return "bg-gray-600"
  if (dailyUsage < 10) return "bg-green-500"
  if (dailyUsage < 15) return "bg-yellow-500"
  if (dailyUsage < 20) return "bg-orange-500"
  return "bg-red-500"
}

/**
 * Generate the last 7 days including today, with data filled in where available.
 */
function generateLast7Days(history: UsageHistoryEntry[]): DayData[] {
  const historyMap = new Map<string, UsageHistoryEntry>()
  for (const entry of history) {
    historyMap.set(entry.date, entry)
  }

  const days: DayData[] = []
  const today = new Date()

  for (let i = 6; i >= 0; i--) {
    const date = new Date(today)
    date.setDate(date.getDate() - i)
    const dateKey = formatDateKey(date)
    const entry = historyMap.get(dateKey)

    days.push({
      date: dateKey,
      dailyUsage: entry?.dailyUsage ?? null,
      utilization: entry?.utilization ?? null,
      hasData: !!entry
    })
  }

  return days
}

/**
 * Format token count for display (e.g., 1.2M, 500K).
 */
function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(0)}K`
  }
  return tokens.toString()
}

/**
 * Calculate session token breakdown from sessions.
 */
function calculateSessionTokens(sessions: Session[]): SessionTokenData[] {
  const sessionsWithTokens = sessions
    .filter(s => s.tokens && s.tokens.total > 0)
    .map(s => ({
      name: s.name,
      displayName: s.displayName,
      tokens: s.tokens?.total ?? 0,
      percentage: 0
    }))
    .sort((a, b) => b.tokens - a.tokens)

  const totalTokens = sessionsWithTokens.reduce((sum, s) => sum + s.tokens, 0)

  return sessionsWithTokens.map(s => ({
    ...s,
    percentage: totalTokens > 0 ? (s.tokens / totalTokens) * 100 : 0
  }))
}

/**
 * 7-day usage history chart popup.
 */
export function UsageChart({ isOpen, onClose }: UsageChartProps): JSX.Element | null {
  const [history, setHistory] = useState<UsageHistoryEntry[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<"daily" | "sessions">("daily")

  // Load history and sessions when opened
  useEffect(() => {
    if (!isOpen) return

    const loadData = async () => {
      setIsLoading(true)
      try {
        const [historyData, sessionsData] = await Promise.all([
          window.api.getUsageHistory(),
          window.api.getSessions()
        ])
        setHistory(historyData)
        setSessions(sessionsData as Session[])
      } catch (err) {
        console.error("Failed to load usage data:", err)
      } finally {
        setIsLoading(false)
      }
    }

    void loadData()
  }, [isOpen])

  // Calculate session token data
  const sessionTokens = useMemo(() => calculateSessionTokens(sessions), [sessions])

  // Close on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, onClose])

  // Close on click outside
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }, [onClose])

  // Generate 7 days data with placeholders
  const days = useMemo(() => generateLast7Days(history), [history])

  // Calculate stats
  const stats = useMemo(() => {
    const withData = days.filter(d => d.hasData && d.dailyUsage !== null && d.dailyUsage > 0)
    const avgDailyUsage = withData.length > 0
      ? withData.reduce((sum, d) => sum + (d.dailyUsage ?? 0), 0) / withData.length
      : null
    const maxDailyUsage = Math.max(20, ...days.map(d => d.dailyUsage ?? 0))
    const daysWithData = days.filter(d => d.hasData).length
    const currentUtilization = days[days.length - 1]?.utilization ?? null

    return { avgDailyUsage, maxDailyUsage, daysWithData, currentUtilization }
  }, [days])

  if (!isOpen) return null

  const totalSessionTokens = sessionTokens.reduce((sum, s) => sum + s.tokens, 0)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
    >
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 p-4">
        {/* Header with tabs */}
        <div className="flex justify-between items-center mb-3">
          <div className="flex gap-1">
            <button
              onClick={() => setActiveTab("daily")}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                activeTab === "daily"
                  ? "bg-blue-600 text-white"
                  : "text-gray-400 hover:bg-gray-700"
              }`}
            >
              Daily Usage
            </button>
            <button
              onClick={() => setActiveTab("sessions")}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                activeTab === "sessions"
                  ? "bg-blue-600 text-white"
                  : "text-gray-400 hover:bg-gray-700"
              }`}
            >
              By Session
            </button>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-700 rounded transition-colors"
            aria-label="Close chart"
          >
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="h-48 flex items-center justify-center">
            <span className="text-gray-500 text-sm">Loading...</span>
          </div>
        ) : activeTab === "daily" ? (
          <div className="space-y-3">
            {/* Info text when little/no data */}
            {stats.daysWithData < 2 && (
              <div className="text-center text-xs text-gray-500 mb-2">
                {stats.daysWithData === 0
                  ? "No usage data recorded yet. Data will appear as you use Claude."
                  : "Keep using Claude to see your daily usage patterns."}
              </div>
            )}

            {/* Bar chart - always show 7 days */}
            <div className="flex items-end justify-between h-32 gap-1 px-1">
              {days.map((day) => {
                const height = day.hasData && day.dailyUsage !== null
                  ? Math.max(8, (day.dailyUsage / stats.maxDailyUsage) * 100)
                  : 8
                const barColor = getBarColor(day.dailyUsage, day.hasData)
                const isToday = day.date === formatDateKey(new Date())

                return (
                  <div
                    key={day.date}
                    className="flex-1 flex flex-col items-center gap-1"
                  >
                    {/* Bar */}
                    <div className="w-full flex flex-col items-center justify-end h-24">
                      <div
                        className={`w-full max-w-[24px] rounded-t ${barColor} transition-all duration-300 ${!day.hasData ? "opacity-30" : ""}`}
                        style={{ height: `${height}%` }}
                        title={day.hasData
                          ? `${day.dailyUsage !== null ? day.dailyUsage.toFixed(1) : 0}% usage on ${day.date}`
                          : `No data for ${day.date}`}
                      />
                    </div>
                    {/* Value label */}
                    <span className={`text-[9px] font-mono ${day.hasData ? "text-gray-400" : "text-gray-600"}`}>
                      {day.hasData && day.dailyUsage !== null ? `${Math.round(day.dailyUsage)}%` : "-"}
                    </span>
                    {/* Day label */}
                    <span className={`text-[9px] ${isToday ? "text-blue-400 font-medium" : "text-gray-500"}`}>
                      {formatDayLabel(day.date)}
                    </span>
                    {/* Date label */}
                    <span className={`text-[8px] ${isToday ? "text-blue-500" : "text-gray-600"}`}>
                      {formatDateLabel(day.date)}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* Summary */}
            <div className="border-t border-gray-700 pt-2 space-y-1">
              <div className="flex justify-between text-xs text-gray-400">
                <span>
                  Avg: {stats.avgDailyUsage !== null ? `${stats.avgDailyUsage.toFixed(1)}%/day` : "N/A"}
                </span>
                <span>
                  Current: {stats.currentUtilization !== null ? `${Math.round(stats.currentUtilization)}%` : "N/A"}
                </span>
              </div>
              {stats.avgDailyUsage !== null && stats.currentUtilization !== null && (
                <div className="text-xs text-gray-500 text-center">
                  ~{((100 - stats.currentUtilization) / stats.avgDailyUsage).toFixed(1)} work days remaining at current pace
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Session token breakdown */}
            {sessionTokens.length === 0 ? (
              <div className="h-48 flex items-center justify-center">
                <span className="text-gray-500 text-sm">No session token data available</span>
              </div>
            ) : (
              <>
                <div className="text-xs text-gray-400 text-center mb-2">
                  Token usage by session (current sessions only)
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {sessionTokens.slice(0, 10).map((session, index) => (
                    <div key={session.name} className="flex items-center gap-2">
                      {/* Rank */}
                      <span className="text-[10px] text-gray-500 w-4 text-right">
                        {index + 1}.
                      </span>
                      {/* Progress bar */}
                      <div className="flex-1 relative">
                        <div className="h-5 bg-gray-700 rounded overflow-hidden">
                          <div
                            className="h-full bg-blue-600 transition-all duration-300"
                            style={{ width: `${session.percentage}%` }}
                          />
                        </div>
                        <div className="absolute inset-0 flex items-center px-2">
                          <span className="text-[10px] text-white truncate flex-1">
                            {session.displayName}
                          </span>
                        </div>
                      </div>
                      {/* Token count */}
                      <span className="text-[10px] text-gray-400 font-mono w-12 text-right">
                        {formatTokenCount(session.tokens)}
                      </span>
                      {/* Percentage */}
                      <span className="text-[10px] text-gray-500 w-8 text-right">
                        {Math.round(session.percentage)}%
                      </span>
                    </div>
                  ))}
                </div>
                {/* Total */}
                <div className="border-t border-gray-700 pt-2 flex justify-between text-xs text-gray-400">
                  <span>Total: {formatTokenCount(totalSessionTokens)} tokens</span>
                  <span>{sessionTokens.length} session{sessionTokens.length !== 1 ? "s" : ""}</span>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
