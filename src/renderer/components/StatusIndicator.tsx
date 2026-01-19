import { useMemo } from "react"

export type SessionStatusType =
  | "active"
  | "working"
  | "waiting"
  | "permission"
  | "idle"
  | "error"

interface StatusIndicatorProps {
  status: SessionStatusType
  detail?: string | null
  size?: "sm" | "md" | "lg"
}

interface StatusConfig {
  color: string
  pulseColor: string
  pulse: boolean
  label: string
}

const STATUS_CONFIG: Record<SessionStatusType, StatusConfig> = {
  active: {
    color: "bg-blue-500",
    pulseColor: "bg-blue-400",
    pulse: true,
    label: "Active"
  },
  working: {
    color: "bg-yellow-500",
    pulseColor: "bg-yellow-400",
    pulse: true,
    label: "Working"
  },
  waiting: {
    color: "bg-green-500",
    pulseColor: "bg-green-400",
    pulse: false,
    label: "Waiting"
  },
  permission: {
    color: "bg-orange-500",
    pulseColor: "bg-orange-400",
    pulse: true,
    label: "Permission"
  },
  idle: {
    color: "bg-gray-500",
    pulseColor: "bg-gray-400",
    pulse: false,
    label: "Idle"
  },
  error: {
    color: "bg-red-500",
    pulseColor: "bg-red-400",
    pulse: false,
    label: "Error"
  }
}

const SIZE_CLASSES = {
  sm: "w-2 h-2",
  md: "w-2.5 h-2.5",
  lg: "w-3 h-3"
}

export function StatusIndicator({
  status,
  detail,
  size = "md"
}: StatusIndicatorProps): JSX.Element {
  const config = useMemo(() => STATUS_CONFIG[status] ?? STATUS_CONFIG.idle, [status])
  const sizeClass = SIZE_CLASSES[size]

  const title = detail ? `${config.label}: ${detail}` : config.label

  return (
    <span
      className="relative inline-flex"
      title={title}
      aria-label={title}
    >
      {/* Pulse animation ring */}
      {config.pulse && (
        <span
          className={`absolute inline-flex h-full w-full rounded-full ${config.pulseColor} opacity-75 animate-ping`}
        />
      )}
      {/* Solid indicator */}
      <span
        className={`relative inline-flex rounded-full ${sizeClass} ${config.color}`}
      />
    </span>
  )
}

/**
 * Get the status color class for use in other components.
 */
export function getStatusColor(status: SessionStatusType): string {
  return STATUS_CONFIG[status]?.color ?? STATUS_CONFIG.idle.color
}

/**
 * Get the text color class that matches the status.
 */
export function getStatusTextColor(status: SessionStatusType): string {
  const colorMap: Record<SessionStatusType, string> = {
    active: "text-blue-400",
    working: "text-yellow-400",
    waiting: "text-green-400",
    permission: "text-orange-400",
    idle: "text-gray-400",
    error: "text-red-400"
  }
  return colorMap[status] ?? colorMap.idle
}
