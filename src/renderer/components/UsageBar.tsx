import { useMemo } from "react"

interface UsageBucketData {
  readonly utilization: number
  readonly resetsAt: string
  readonly resetsAtIso: string
}

interface UsageData {
  readonly fiveHour: UsageBucketData
  readonly sevenDay: UsageBucketData
  readonly sevenDaySonnet: UsageBucketData | null
  readonly extraUsage: {
    readonly isEnabled: boolean
    readonly monthlyLimit: number | null
    readonly usedCredits: number | null
    readonly utilization: number | null
  } | null
  readonly fetchedAt: string
}

interface UsageBarProps {
  usage: UsageData | null
  isLoading?: boolean
  oauthAvailable?: boolean | undefined
}

/**
 * Get color class based on utilization percentage.
 */
function getUsageColor(utilization: number): string {
  if (utilization < 50) return "bg-green-500"
  if (utilization < 75) return "bg-yellow-500"
  if (utilization < 90) return "bg-orange-500"
  return "bg-red-500"
}

/**
 * Get text color class based on utilization percentage.
 */
function getTextColor(utilization: number): string {
  if (utilization < 50) return "text-green-400"
  if (utilization < 75) return "text-yellow-400"
  if (utilization < 90) return "text-orange-400"
  return "text-red-400"
}

/**
 * Format time until reset in human-readable format.
 */
function formatTimeUntilReset(resetsAtIso: string): string {
  const resetsAt = new Date(resetsAtIso)
  const now = new Date()
  const diff = resetsAt.getTime() - now.getTime()

  if (diff <= 0) return "now"

  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

  if (hours === 0) return `${minutes}m`
  if (hours < 24) return `${hours}h`

  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  if (remainingHours === 0) return `${days}d`
  return `${days}d ${remainingHours}h`
}

/**
 * Single usage bucket display (compact horizontal bar).
 */
function UsageBucket({
  label,
  utilization,
  resetsAtIso
}: {
  label: string
  utilization: number
  resetsAtIso: string
}): JSX.Element {
  const barColor = useMemo(() => getUsageColor(utilization), [utilization])
  const textColor = useMemo(() => getTextColor(utilization), [utilization])
  const resetTime = useMemo(() => formatTimeUntilReset(resetsAtIso), [resetsAtIso])

  return (
    <div className="flex items-center gap-1.5">
      {/* Label */}
      <span className="text-[10px] text-gray-500 w-6 shrink-0">{label}</span>

      {/* Progress bar */}
      <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden min-w-[40px]">
        <div
          className={`h-full ${barColor} transition-all duration-300 ease-out`}
          style={{ width: `${Math.min(100, utilization)}%` }}
          role="progressbar"
          aria-valuenow={utilization}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${label} usage: ${utilization}%`}
        />
      </div>

      {/* Percentage and reset time */}
      <span className={`text-[10px] font-mono ${textColor} min-w-[32px] text-right shrink-0`}>
        {Math.round(utilization)}%
      </span>
      <span className="text-[10px] text-gray-600 min-w-[28px] text-right shrink-0">
        {resetTime}
      </span>
    </div>
  )
}

/**
 * Full usage display showing all buckets.
 */
export function UsageBar({ usage, isLoading, oauthAvailable }: UsageBarProps): JSX.Element {
  if (isLoading) {
    return (
      <div className="space-y-1 animate-pulse">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-gray-500 w-6">5h</span>
          <div className="flex-1 h-1.5 bg-gray-700 rounded-full" />
          <span className="text-[10px] text-gray-600 w-8">--</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-gray-500 w-6">7d</span>
          <div className="flex-1 h-1.5 bg-gray-700 rounded-full" />
          <span className="text-[10px] text-gray-600 w-8">--</span>
        </div>
      </div>
    )
  }

  if (oauthAvailable === false) {
    return (
      <div className="text-[10px] text-gray-500 text-center py-1">
        Sign in to Claude Code to see usage
      </div>
    )
  }

  if (!usage) {
    return (
      <div className="text-[10px] text-gray-500 text-center py-1">
        Usage unavailable
      </div>
    )
  }

  return (
    <div className="space-y-0.5">
      <UsageBucket
        label="5h"
        utilization={usage.fiveHour.utilization}
        resetsAtIso={usage.fiveHour.resetsAtIso}
      />
      <UsageBucket
        label="7d"
        utilization={usage.sevenDay.utilization}
        resetsAtIso={usage.sevenDay.resetsAtIso}
      />
      {usage.sevenDaySonnet && (
        <UsageBucket
          label="Son"
          utilization={usage.sevenDaySonnet.utilization}
          resetsAtIso={usage.sevenDaySonnet.resetsAtIso}
        />
      )}
    </div>
  )
}

/**
 * Compact single-line usage display for footer.
 */
export function UsageBarCompact({ usage, oauthAvailable }: UsageBarProps): JSX.Element {
  if (oauthAvailable === false || !usage) {
    return <span className="text-gray-600 text-xs">--</span>
  }

  const fiveHourColor = getTextColor(usage.fiveHour.utilization)
  const sevenDayColor = getTextColor(usage.sevenDay.utilization)
  const fiveHourReset = formatTimeUntilReset(usage.fiveHour.resetsAtIso)
  const sevenDayReset = formatTimeUntilReset(usage.sevenDay.resetsAtIso)

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`font-mono ${fiveHourColor}`} title={`5h limit resets in ${fiveHourReset}`}>
        5h:{Math.round(usage.fiveHour.utilization)}%
      </span>
      <span className={`font-mono ${sevenDayColor}`} title={`7d limit resets in ${sevenDayReset}`}>
        7d:{Math.round(usage.sevenDay.utilization)}%
      </span>
    </div>
  )
}
