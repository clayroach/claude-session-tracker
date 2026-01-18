import { useMemo } from "react"

interface ContextBarProps {
  percent: number
  showLabel?: boolean
  height?: "sm" | "md" | "lg"
}

const HEIGHT_CLASSES = {
  sm: "h-1",
  md: "h-1.5",
  lg: "h-2"
}

/**
 * Get the color class based on context usage percentage.
 * - 0-50%: Green (healthy)
 * - 50-75%: Yellow (warning)
 * - 75-100%: Red (critical)
 */
function getBarColor(percent: number): string {
  if (percent < 50) {
    return "bg-green-500"
  } else if (percent < 75) {
    return "bg-yellow-500"
  } else {
    return "bg-red-500"
  }
}

/**
 * Get the text color class based on context usage percentage.
 */
function getTextColor(percent: number): string {
  if (percent < 50) {
    return "text-green-400"
  } else if (percent < 75) {
    return "text-yellow-400"
  } else {
    return "text-red-400"
  }
}

export function ContextBar({
  percent,
  showLabel = true,
  height = "md"
}: ContextBarProps): JSX.Element {
  const clampedPercent = useMemo(
    () => Math.max(0, Math.min(100, percent)),
    [percent]
  )

  const barColor = useMemo(() => getBarColor(clampedPercent), [clampedPercent])
  const textColor = useMemo(() => getTextColor(clampedPercent), [clampedPercent])
  const heightClass = HEIGHT_CLASSES[height]

  return (
    <div className="flex items-center gap-2">
      {/* Progress bar background */}
      <div className={`flex-1 ${heightClass} bg-gray-700 rounded-full overflow-hidden`}>
        {/* Progress bar fill */}
        <div
          className={`h-full ${barColor} transition-all duration-300 ease-out`}
          style={{ width: `${clampedPercent}%` }}
          role="progressbar"
          aria-valuenow={clampedPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Context usage: ${clampedPercent}%`}
        />
      </div>

      {/* Percentage label */}
      {showLabel && (
        <span className={`text-xs font-mono ${textColor} min-w-[3ch] text-right`}>
          {clampedPercent}%
        </span>
      )}
    </div>
  )
}

/**
 * Compact version of ContextBar for tight spaces.
 */
export function ContextBarCompact({
  percent
}: {
  percent: number
}): JSX.Element {
  return <ContextBar percent={percent} showLabel={false} height="sm" />
}
