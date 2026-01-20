import { useState, useEffect, useCallback } from "react"

interface UsageHistoryEntry {
  date: string
  utilization: number
  dailyUsage: number | null
  timestamp: number
}

interface UsageChartProps {
  isOpen: boolean
  onClose: () => void
}

/**
 * Format date as short weekday (Mon, Tue, etc.)
 */
function formatDayLabel(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString("en-US", { weekday: "short" })
}

/**
 * Format date as MM/DD
 */
function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

/**
 * Get color for daily usage bar based on percentage.
 */
function getBarColor(dailyUsage: number | null): string {
  if (dailyUsage === null) return "bg-gray-600"
  if (dailyUsage < 10) return "bg-green-500"
  if (dailyUsage < 15) return "bg-yellow-500"
  if (dailyUsage < 20) return "bg-orange-500"
  return "bg-red-500"
}

/**
 * 7-day usage history chart popup.
 */
export function UsageChart({ isOpen, onClose }: UsageChartProps): JSX.Element | null {
  const [history, setHistory] = useState<UsageHistoryEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Load history when opened
  useEffect(() => {
    if (!isOpen) return

    const loadHistory = async () => {
      setIsLoading(true)
      try {
        const data = await window.api.getUsageHistory()
        setHistory(data)
      } catch (err) {
        console.error("Failed to load usage history:", err)
      } finally {
        setIsLoading(false)
      }
    }

    void loadHistory()
  }, [isOpen])

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

  if (!isOpen) return null

  // Calculate max daily usage for scaling
  const maxDailyUsage = Math.max(
    20, // Minimum scale
    ...history.map(e => e.dailyUsage ?? 0)
  )

  // Calculate average for display
  const dailyUsages = history.filter(e => e.dailyUsage !== null && e.dailyUsage > 0).map(e => e.dailyUsage as number)
  const avgDailyUsage = dailyUsages.length > 0
    ? dailyUsages.reduce((a, b) => a + b, 0) / dailyUsages.length
    : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
    >
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-sm mx-4 p-4">
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-sm font-semibold text-white">Daily Usage (Last 7 Days)</h2>
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

        {/* Chart */}
        {isLoading ? (
          <div className="h-40 flex items-center justify-center">
            <span className="text-gray-500 text-sm">Loading...</span>
          </div>
        ) : history.length === 0 ? (
          <div className="h-40 flex items-center justify-center">
            <span className="text-gray-500 text-sm">No usage data yet</span>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Bar chart */}
            <div className="flex items-end justify-between h-32 gap-1 px-1">
              {history.map((entry) => {
                const height = entry.dailyUsage !== null
                  ? Math.max(4, (entry.dailyUsage / maxDailyUsage) * 100)
                  : 4
                const barColor = getBarColor(entry.dailyUsage)

                return (
                  <div
                    key={entry.date}
                    className="flex-1 flex flex-col items-center gap-1"
                  >
                    {/* Bar */}
                    <div className="w-full flex flex-col items-center justify-end h-24">
                      <div
                        className={`w-full max-w-[24px] rounded-t ${barColor} transition-all duration-300`}
                        style={{ height: `${height}%` }}
                        title={`${entry.dailyUsage !== null ? entry.dailyUsage.toFixed(1) : 0}% usage on ${entry.date}`}
                      />
                    </div>
                    {/* Value label */}
                    <span className="text-[9px] text-gray-400 font-mono">
                      {entry.dailyUsage !== null ? `${Math.round(entry.dailyUsage)}%` : "-"}
                    </span>
                    {/* Day label */}
                    <span className="text-[9px] text-gray-500">
                      {formatDayLabel(entry.date)}
                    </span>
                    {/* Date label */}
                    <span className="text-[8px] text-gray-600">
                      {formatDateLabel(entry.date)}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* Summary */}
            <div className="border-t border-gray-700 pt-2 flex justify-between text-xs text-gray-400">
              <span>
                Avg: {avgDailyUsage !== null ? `${avgDailyUsage.toFixed(1)}%/day` : "N/A"}
              </span>
              <span>
                Total tracked: {history.length} day{history.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
