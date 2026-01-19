import { useEffect, useState, useCallback, useMemo } from "react"
import { SessionRow, SessionRowCompact, EmptyState, Settings, ClaudeLogo } from "./components"
import { type Session } from "./types"

type CardSize = "regular" | "compact"
type SortBy = "recent" | "status" | "name" | "context"

interface UsageSettings {
  usagePercent?: number
  resetDayOfWeek?: number
  resetHour?: number
  resetMinute?: number
}

/**
 * Calculate days until the next reset time, in quarter-day increments.
 */
function calculateDaysUntilReset(
  resetDayOfWeek: number,
  resetHour: number,
  resetMinute: number
): string {
  const now = new Date()
  const currentDay = now.getDay()
  const currentHour = now.getHours()
  const currentMinute = now.getMinutes()

  // Calculate days until reset day
  let daysUntil = resetDayOfWeek - currentDay
  if (daysUntil < 0) daysUntil += 7
  if (daysUntil === 0) {
    // Same day - check if reset time has passed
    const resetMinutes = resetHour * 60 + resetMinute
    const currentMinutes = currentHour * 60 + currentMinute
    if (currentMinutes >= resetMinutes) {
      daysUntil = 7 // Already passed, next week
    }
  }

  // Calculate fractional hours remaining today
  const resetMinutesInDay = resetHour * 60 + resetMinute
  const currentMinutesInDay = currentHour * 60 + currentMinute

  let totalMinutesUntilReset: number
  if (daysUntil === 0) {
    totalMinutesUntilReset = resetMinutesInDay - currentMinutesInDay
  } else {
    // Minutes until end of day + full days + minutes from midnight to reset
    const minutesUntilMidnight = 24 * 60 - currentMinutesInDay
    const fullDaysMinutes = (daysUntil - 1) * 24 * 60
    totalMinutesUntilReset = minutesUntilMidnight + fullDaysMinutes + resetMinutesInDay
  }

  // Convert to days and round to nearest quarter
  const daysFloat = totalMinutesUntilReset / (24 * 60)
  const roundedQuarter = Math.round(daysFloat * 4) / 4

  // Format nicely
  if (roundedQuarter === 0) return "<1d"
  if (roundedQuarter % 1 === 0) return `${roundedQuarter}d`
  return `${roundedQuarter}d`
}

export function App(): JSX.Element {
  const [sessions, setSessions] = useState<Session[]>([])
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [cardSize, setCardSize] = useState<CardSize>("regular")
  const [sortBy, setSortBy] = useState<SortBy>("recent")
  const [hiddenSessions, setHiddenSessions] = useState<Set<string>>(new Set())
  const [showHidden, setShowHidden] = useState(false)
  const [usageSettings, setUsageSettings] = useState<UsageSettings>({
    usagePercent: 0,
    resetDayOfWeek: 4, // Thursday
    resetHour: 9,
    resetMinute: 59
  })
  const [opacity, setOpacity] = useState(1.0)

  // LRU session history (most recent first)
  const [lruHistory, setLruHistory] = useState<string[]>([])

  // Calculate days until reset
  const daysUntilReset = useMemo(() => {
    return calculateDaysUntilReset(
      usageSettings.resetDayOfWeek ?? 4,
      usageSettings.resetHour ?? 9,
      usageSettings.resetMinute ?? 59
    )
  }, [usageSettings.resetDayOfWeek, usageSettings.resetHour, usageSettings.resetMinute])

  // Format reset display: "3.5d" or "Thu 10AM"
  const resetDisplay = useMemo(() => {
    const daysNum = parseFloat(daysUntilReset.replace('d', '').replace('<1', '0.25'))

    // If more than 1 day away, show days
    if (daysNum > 1) {
      return `${daysUntilReset} till reset`
    }

    // Otherwise show day and time
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const dayName = dayNames[usageSettings.resetDayOfWeek ?? 4]
    const hour = usageSettings.resetHour ?? 9
    const minute = usageSettings.resetMinute ?? 59

    // Format hour as 12-hour time
    const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
    const ampm = hour >= 12 ? 'PM' : 'AM'
    const minuteStr = minute === 0 ? '' : `:${minute.toString().padStart(2, '0')}`

    return `${dayName} ${hour12}${minuteStr}${ampm}`
  }, [daysUntilReset, usageSettings.resetDayOfWeek, usageSettings.resetHour, usageSettings.resetMinute])

  // Calculate usage color based on days remaining
  const usageColor = useMemo(() => {
    const usage = usageSettings.usagePercent ?? 0
    const daysRemaining = parseFloat(daysUntilReset.replace('d', '').replace('<1', '0.25'))
    const totalDays = 7
    const daysElapsed = totalDays - daysRemaining

    // Expected usage at this point in the week
    const expectedUsage = (daysElapsed / totalDays) * 100
    const deviation = usage - expectedUsage

    // Within ±5% of expected: green (on track)
    if (Math.abs(deviation) <= 5) return "text-green-400"

    // Ahead of schedule (using too much)
    if (deviation > 5 && deviation <= 15) return "text-yellow-400"
    if (deviation > 15 && deviation <= 25) return "text-orange-400"
    if (deviation > 25) return "text-red-400"

    // Behind schedule (using less than expected): still green
    return "text-green-400"
  }, [usageSettings.usagePercent, daysUntilReset])

  // Load settings and sessions on mount
  useEffect(() => {
    const loadData = async (): Promise<void> => {
      // Load settings
      const settings = await window.api.getSettings()
      if (settings.display) {
        if (settings.display.cardSize) setCardSize(settings.display.cardSize)
        if (settings.display.sortBy) setSortBy(settings.display.sortBy)
        if (settings.display.hiddenSessions) setHiddenSessions(new Set(settings.display.hiddenSessions))
        if (settings.display.showHidden !== undefined) setShowHidden(settings.display.showHidden)
      }
      if (settings.usage) {
        setUsageSettings(settings.usage)
      }
      if (settings.display?.opacity !== undefined) {
        setOpacity(settings.display.opacity)
      }

      // Load sessions
      const data = await window.api.getSessions()
      setSessions(data as Session[])
    }

    void loadData()
    window.api.onSessionsUpdate((data) => setSessions(data as Session[]))
    window.api.onSettingsUpdate((settings) => {
      if (settings.display) {
        if (settings.display.cardSize) setCardSize(settings.display.cardSize)
        if (settings.display.sortBy) setSortBy(settings.display.sortBy)
        if (settings.display.hiddenSessions) setHiddenSessions(new Set(settings.display.hiddenSessions))
        if (settings.display.showHidden !== undefined) setShowHidden(settings.display.showHidden)
        if (settings.display.opacity !== undefined) setOpacity(settings.display.opacity)
      }
      if (settings.usage) {
        setUsageSettings(settings.usage)
      }
    })
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

  // Track session access for LRU ordering
  const trackSessionAccess = useCallback((sessionName: string) => {
    setLruHistory((prev) => {
      // Remove if already in history, then add to front (most recent)
      const filtered = prev.filter((name) => name !== sessionName)
      return [sessionName, ...filtered].slice(0, 20) // Keep top 20
    })
  }, [])

  // Focus session handler
  const handleFocusSession = useCallback((name: string) => {
    console.log("[App] handleFocusSession called:", name)
    trackSessionAccess(name)
    void window.api.focusSession(name)
  }, [trackSessionAccess])

  // Get LRU position for a session (1-based, or 0 if not in history)
  const getLruPosition = useCallback((sessionName: string): number => {
    const index = lruHistory.indexOf(sessionName)
    return index === -1 ? 0 : index + 1
  }, [lruHistory])

  // Open editor handler (for single-click)
  const handleOpenEditor = useCallback((path: string) => {
    console.log("[App] handleOpenEditor called:", path)
    void window.api.openEditor(path)
  }, [])

  // Settings handlers
  const handleOpenSettings = useCallback(() => {
    setIsSettingsOpen(true)
  }, [])

  const handleCloseSettings = useCallback(() => {
    setIsSettingsOpen(false)
  }, [])

  // Hide/unhide session
  const handleToggleHide = useCallback(async (sessionName: string) => {
    const newHidden = new Set(hiddenSessions)
    if (newHidden.has(sessionName)) {
      newHidden.delete(sessionName)
    } else {
      newHidden.add(sessionName)
    }
    setHiddenSessions(newHidden)

    // Save to settings
    const settings = await window.api.getSettings()
    await window.api.saveSettings({
      ...settings,
      display: {
        ...settings.display,
        hiddenSessions: Array.from(newHidden)
      }
    })
  }, [hiddenSessions])

  // Toggle show hidden
  const handleToggleShowHidden = useCallback(async () => {
    const newShowHidden = !showHidden
    setShowHidden(newShowHidden)

    // Save to settings
    const settings = await window.api.getSettings()
    await window.api.saveSettings({
      ...settings,
      display: {
        ...settings.display,
        showHidden: newShowHidden
      }
    })
  }, [showHidden])

  // Handle opacity change
  const handleOpacityChange = useCallback(async (newOpacity: number) => {
    setOpacity(newOpacity)
    void window.api.setWindowOpacity(newOpacity)

    // Save to settings
    const settings = await window.api.getSettings()
    await window.api.saveSettings({
      ...settings,
      display: {
        ...settings.display,
        opacity: newOpacity
      }
    })
  }, [])

  // Filter and sort sessions
  const filteredSessions = sessions.filter(
    (s) => showHidden || !hiddenSessions.has(s.name)
  )

  const sortedSessions = [...filteredSessions].sort((a, b) => {
    switch (sortBy) {
      case "status": {
        // Priority: permission > waiting > working > active > idle > error
        const statusOrder: Record<string, number> = {
          permission: 0,
          waiting: 1,
          working: 2,
          active: 3,
          idle: 4,
          error: 5
        }
        const aOrder = statusOrder[a.status] ?? 6
        const bOrder = statusOrder[b.status] ?? 6
        return aOrder - bOrder
      }
      case "name":
        return a.displayName.localeCompare(b.displayName)
      case "context":
        return b.contextPercent - a.contextPercent
      case "recent":
      default:
        // Already sorted by recent from backend
        return 0
    }
  })

  // Render session row based on card size
  const renderSession = (session: Session) => {
    const isHidden = hiddenSessions.has(session.name)
    const lruPosition = getLruPosition(session.name)
    const props = {
      session,
      onFocus: handleFocusSession,
      onOpenEditor: handleOpenEditor,
      onToggleHide: handleToggleHide,
      isHidden,
      lruPosition
    }
    return cardSize === "compact" ? (
      <SessionRowCompact key={session.name} {...props} />
    ) : (
      <SessionRow key={session.name} {...props} />
    )
  }

  return (
    <div className="bg-gray-900/95 text-white h-screen flex flex-col rounded-lg border border-gray-700/50">
      {/* Draggable header */}
      <header className="flex justify-between items-center px-3 py-2 drag">
        <div className="flex items-center gap-1.5">
          <ClaudeLogo size={16} />
          <h1 className="text-sm font-medium text-gray-300">Sessions</h1>
        </div>
        <div className="flex items-center gap-1 no-drag">
          {/* Show hidden toggle (only show if there are hidden sessions) */}
          {hiddenSessions.size > 0 && (
            <button
              onClick={() => void handleToggleShowHidden()}
              className={`p-1.5 rounded transition-colors ${showHidden ? "bg-gray-700 text-gray-300" : "hover:bg-gray-700 text-gray-500"}`}
              title={showHidden ? "Hide hidden sessions" : `Show ${hiddenSessions.size} hidden`}
              aria-label={showHidden ? "Hide hidden sessions" : "Show hidden sessions"}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {showHidden ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                )}
              </svg>
            </button>
          )}
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
      <main className={`flex-1 overflow-y-auto px-3 pb-2 ${cardSize === "compact" ? "space-y-1" : "space-y-2"}`}>
        {sortedSessions.length === 0 ? (
          <EmptyState />
        ) : (
          sortedSessions.map(renderSession)
        )}
      </main>

      {/* Footer with controls */}
      <footer className="text-gray-500 text-xs px-3 py-2 border-t border-gray-800 no-drag">
        <div className="flex items-center justify-between gap-2">
          {/* Left: Transparency slider */}
          <div className="flex items-center gap-1.5">
            <svg className="w-3 h-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
            <input
              type="range"
              min="30"
              max="100"
              value={Math.round(opacity * 100)}
              onChange={(e) => void handleOpacityChange(Number(e.target.value) / 100)}
              className="w-16 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-gray-500"
              title={`Opacity: ${Math.round(opacity * 100)}%`}
            />
          </div>

          {/* Center: Keyboard shortcut */}
          <div className="text-gray-600">
            <kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-500 text-[10px]">⌘⇧C</kbd>
          </div>

          {/* Right: Usage % display (read-only, color-coded) */}
          <div className="flex items-center gap-1.5">
            <span className={`font-semibold text-sm ${usageColor}`}>
              {usageSettings.usagePercent ?? 0}%
            </span>
            <span className="text-gray-500 text-xs">({resetDisplay})</span>
          </div>
        </div>
      </footer>

      {/* Settings modal */}
      <Settings isOpen={isSettingsOpen} onClose={handleCloseSettings} />
    </div>
  )
}
