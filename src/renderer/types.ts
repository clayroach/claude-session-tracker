/**
 * Serialized session data received from main process via IPC.
 * This mirrors the SerializedSession type from SessionService.
 */
export interface Session {
  readonly name: string
  readonly displayName: string
  readonly attached: boolean
  readonly path: string
  readonly repo: string | null
  readonly status: string
  readonly statusDetail: string | null
  readonly summary: string
  readonly contextPercent: number
  readonly lastActivity: string
  readonly model: string | null
  readonly gitBranch: string | null
}

/**
 * Valid session status types.
 */
export type SessionStatus =
  | "active"
  | "working"
  | "waiting"
  | "permission"
  | "idle"
  | "error"

/**
 * Type guard to check if a string is a valid SessionStatus.
 */
export function isSessionStatus(value: string): value is SessionStatus {
  return ["active", "working", "waiting", "permission", "idle", "error"].includes(value)
}

/**
 * Safely get session status from string, defaulting to "idle".
 */
export function getSessionStatus(status: string): SessionStatus {
  return isSessionStatus(status) ? status : "idle"
}
