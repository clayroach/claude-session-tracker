import { Effect, Data, Schema, Option } from "effect"
import { execSync } from "child_process"

// ============================================================================
// Errors
// ============================================================================

export class UsageError extends Data.TaggedError("UsageError")<{
  readonly operation: string
  readonly message: string
}> {}

// ============================================================================
// Schemas
// ============================================================================

const UsageBucket = Schema.Struct({
  utilization: Schema.Number,
  resets_at: Schema.String
})

const ExtraUsage = Schema.Struct({
  is_enabled: Schema.Boolean,
  monthly_limit: Schema.NullOr(Schema.Number),
  used_credits: Schema.NullOr(Schema.Number),
  utilization: Schema.NullOr(Schema.Number)
})

const UsageResponseSchema = Schema.Struct({
  five_hour: UsageBucket,
  seven_day: UsageBucket,
  seven_day_sonnet: Schema.optional(UsageBucket),
  extra_usage: Schema.optional(ExtraUsage)
})

// OAuth credential structure stored in keychain
// Using a more permissive schema that only extracts what we need
const OAuthInnerCredential = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.optional(Schema.String),
  // expiresAt can be a number (timestamp) or string
  expiresAt: Schema.optional(Schema.Union(Schema.Number, Schema.String))
}).pipe(Schema.extend(Schema.Record({ key: Schema.String, value: Schema.Unknown })))

const OAuthCredential = Schema.Struct({
  claudeAiOauth: Schema.optional(OAuthInnerCredential)
})

// ============================================================================
// Data Types
// ============================================================================

export interface UsageBucketData {
  readonly utilization: number
  readonly resetsAt: Date
  readonly resetsAtIso: string
}

export interface UsageData {
  readonly fiveHour: UsageBucketData
  readonly sevenDay: UsageBucketData
  readonly sevenDaySonnet: Option.Option<UsageBucketData>
  readonly extraUsage: Option.Option<{
    readonly isEnabled: boolean
    readonly monthlyLimit: number | null
    readonly usedCredits: number | null
    readonly utilization: number | null
  }>
  readonly fetchedAt: Date
}

export interface SerializedUsageData {
  readonly fiveHour: {
    readonly utilization: number
    readonly resetsAt: string
    readonly resetsAtIso: string
  }
  readonly sevenDay: {
    readonly utilization: number
    readonly resetsAt: string
    readonly resetsAtIso: string
  }
  readonly sevenDaySonnet: {
    readonly utilization: number
    readonly resetsAt: string
    readonly resetsAtIso: string
  } | null
  readonly extraUsage: {
    readonly isEnabled: boolean
    readonly monthlyLimit: number | null
    readonly usedCredits: number | null
    readonly utilization: number | null
  } | null
  readonly fetchedAt: string
}

// Import UsageHistory types from SettingsStore
import type { UsageHistory, UsageHistoryEntry } from "./SettingsStore.js"

// ============================================================================
// Configuration
// ============================================================================

const KEYCHAIN_SERVICE = "Claude Code-credentials"
const USAGE_API_URL = "https://api.anthropic.com/api/oauth/usage"
const ANTHROPIC_BETA_HEADER = "oauth-2025-04-20"

// Cache configuration
const CACHE_TTL_MS = 300000 // 5 minute cache

// ============================================================================
// Cache
// ============================================================================

interface CacheEntry {
  data: UsageData
  timestamp: number
}

let usageCache: CacheEntry | null = null

// ============================================================================
// Service Implementation
// ============================================================================

/**
 * Read OAuth token from macOS Keychain using the security CLI.
 * This approach avoids native module issues with keytar.
 */
export const readOAuthToken = Effect.gen(function* () {
  // Use macOS security command to read the keychain entry
  // The -w flag outputs only the password data
  const credentialJson = yield* Effect.try({
    try: () => {
      const result = execSync(
        `security find-generic-password -s "${KEYCHAIN_SERVICE}" -w 2>/dev/null`,
        { encoding: "utf-8", timeout: 5000 }
      )
      return result.trim()
    },
    catch: (error) => {
      // security command returns non-zero if entry not found
      return new UsageError({
        operation: "readOAuthToken",
        message: `Keychain entry not found or access denied: ${String(error)}`
      })
    }
  })

  if (!credentialJson) {
    return yield* Effect.fail(new UsageError({
      operation: "readOAuthToken",
      message: "Keychain entry is empty"
    }))
  }

  // Parse the JSON credential
  let parsed: unknown
  try {
    parsed = JSON.parse(credentialJson)
  } catch {
    return yield* Effect.fail(new UsageError({
      operation: "readOAuthToken",
      message: "Failed to parse keychain credential as JSON"
    }))
  }

  // Validate and extract access token
  const credential = Schema.decodeUnknownOption(OAuthCredential)(parsed)
  if (Option.isNone(credential)) {
    return yield* Effect.fail(new UsageError({
      operation: "readOAuthToken",
      message: "Invalid credential format in keychain"
    }))
  }

  const accessToken = credential.value.claudeAiOauth?.accessToken
  if (!accessToken) {
    return yield* Effect.fail(new UsageError({
      operation: "readOAuthToken",
      message: "No access token found in credential"
    }))
  }

  return accessToken
})

/**
 * Fetch usage data from Anthropic API.
 */
export const fetchUsageFromApi = (accessToken: string) =>
  Effect.gen(function* () {
    // Use fetch to call the API
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(USAGE_API_URL, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "anthropic-beta": ANTHROPIC_BETA_HEADER,
            Accept: "application/json"
          }
        }),
      catch: (error) => new UsageError({
        operation: "fetchUsageFromApi",
        message: `Network error: ${String(error)}`
      })
    })

    if (!response.ok) {
      const errorText = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: () => "Unknown error"
      })
      return yield* Effect.fail(new UsageError({
        operation: "fetchUsageFromApi",
        message: `API error ${response.status}: ${errorText}`
      }))
    }

    const json = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: () => new UsageError({
        operation: "fetchUsageFromApi",
        message: "Failed to parse API response"
      })
    })

    // Validate response schema
    const validated = Schema.decodeUnknownOption(UsageResponseSchema)(json)
    if (Option.isNone(validated)) {
      return yield* Effect.fail(new UsageError({
        operation: "fetchUsageFromApi",
        message: "Invalid API response format"
      }))
    }

    const data = validated.value
    const now = new Date()

    // Convert to UsageData
    const usageData: UsageData = {
      fiveHour: {
        utilization: data.five_hour.utilization,
        resetsAt: new Date(data.five_hour.resets_at),
        resetsAtIso: data.five_hour.resets_at
      },
      sevenDay: {
        utilization: data.seven_day.utilization,
        resetsAt: new Date(data.seven_day.resets_at),
        resetsAtIso: data.seven_day.resets_at
      },
      sevenDaySonnet: data.seven_day_sonnet
        ? Option.some({
            utilization: data.seven_day_sonnet.utilization,
            resetsAt: new Date(data.seven_day_sonnet.resets_at),
            resetsAtIso: data.seven_day_sonnet.resets_at
          })
        : Option.none(),
      extraUsage: data.extra_usage
        ? Option.some({
            isEnabled: data.extra_usage.is_enabled,
            monthlyLimit: data.extra_usage.monthly_limit,
            usedCredits: data.extra_usage.used_credits,
            utilization: data.extra_usage.utilization
          })
        : Option.none(),
      fetchedAt: now
    }

    return usageData
  })

/**
 * Get usage data with caching.
 */
export const getUsage = Effect.gen(function* () {
  // Check cache first
  const now = Date.now()
  if (usageCache && (now - usageCache.timestamp) < CACHE_TTL_MS) {
    yield* Effect.log("Returning cached usage data")
    return usageCache.data
  }

  // Fetch fresh data
  const accessToken = yield* readOAuthToken
  const usageData = yield* fetchUsageFromApi(accessToken)

  // Update cache
  usageCache = {
    data: usageData,
    timestamp: now
  }

  yield* Effect.log(`Fetched usage: 5h=${usageData.fiveHour.utilization}%, 7d=${usageData.sevenDay.utilization}%`)
  return usageData
})

/**
 * Clear the usage cache.
 */
export const clearUsageCache = Effect.sync(() => {
  usageCache = null
})

/**
 * Check if OAuth token is available.
 */
export const isOAuthAvailable = readOAuthToken.pipe(
  Effect.map(() => true),
  Effect.catchAll(() => Effect.succeed(false))
)

/**
 * Serialize usage data for IPC transport.
 */
export const serializeUsage = (data: UsageData): SerializedUsageData => ({
  fiveHour: {
    utilization: data.fiveHour.utilization,
    resetsAt: data.fiveHour.resetsAt.toISOString(),
    resetsAtIso: data.fiveHour.resetsAtIso
  },
  sevenDay: {
    utilization: data.sevenDay.utilization,
    resetsAt: data.sevenDay.resetsAt.toISOString(),
    resetsAtIso: data.sevenDay.resetsAtIso
  },
  sevenDaySonnet: Option.isSome(data.sevenDaySonnet)
    ? {
        utilization: data.sevenDaySonnet.value.utilization,
        resetsAt: data.sevenDaySonnet.value.resetsAt.toISOString(),
        resetsAtIso: data.sevenDaySonnet.value.resetsAtIso
      }
    : null,
  extraUsage: Option.isSome(data.extraUsage)
    ? {
        isEnabled: data.extraUsage.value.isEnabled,
        monthlyLimit: data.extraUsage.value.monthlyLimit,
        usedCredits: data.extraUsage.value.usedCredits,
        utilization: data.extraUsage.value.utilization
      }
    : null,
  fetchedAt: data.fetchedAt.toISOString()
})

/**
 * Format time until reset in human-readable format.
 */
export const formatTimeUntilReset = (resetsAt: Date): string => {
  const now = new Date()
  const diff = resetsAt.getTime() - now.getTime()

  if (diff <= 0) return "now"

  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

  if (hours === 0) return `${minutes}m`
  if (hours < 24) return `${hours}h ${minutes}m`

  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return `${days}d ${remainingHours}h`
}

// ============================================================================
// Usage History Functions
// ============================================================================

/**
 * Get today's date as YYYY-MM-DD string.
 */
const getTodayDate = (): string => {
  const now = new Date()
  return now.toISOString().split("T")[0] ?? ""
}

/**
 * Record current usage to history (called once per day).
 * Returns updated history with daily usage calculated.
 */
export const recordUsageToHistory = (
  history: UsageHistory,
  currentUtilization: number
): UsageHistory => {
  const today = getTodayDate()

  // Don't record if we already recorded today
  if (history.lastRecordedDate === today) {
    return history
  }

  // Keep only last 14 days of history
  const recentEntries = history.entries
    .filter(e => {
      const entryDate = new Date(e.date)
      const fourteenDaysAgo = new Date()
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)
      return entryDate >= fourteenDaysAgo
    })

  // Calculate daily usage (delta from previous day)
  // Only positive deltas count as actual usage; negative means the rolling window dropped old usage
  let dailyUsage: number | null = null
  if (recentEntries.length > 0) {
    const lastEntry = recentEntries[recentEntries.length - 1]
    if (lastEntry) {
      const delta = currentUtilization - lastEntry.utilization
      // Only record positive deltas as daily usage
      dailyUsage = delta > 0 ? delta : 0
    }
  }

  const newEntry: UsageHistoryEntry = {
    date: today,
    utilization: currentUtilization,
    dailyUsage,
    timestamp: Date.now()
  }

  return {
    entries: [...recentEntries, newEntry],
    lastRecordedDate: today
  }
}

/**
 * Calculate average daily usage from history.
 * Uses pre-calculated dailyUsage values, or computes from deltas for older entries.
 */
export const calculateAvgDailyUsage = (history: UsageHistory): number | null => {
  if (history.entries.length < 2) {
    return null // Need at least 2 data points
  }

  // Collect daily usage values (only positive values count as actual work days)
  const dailyUsages: number[] = history.entries
    .filter(e => e.dailyUsage !== null && e.dailyUsage > 0)
    .map(e => e.dailyUsage as number)

  // Fallback: calculate from deltas for entries without dailyUsage
  if (dailyUsages.length === 0) {
    const sorted = [...history.entries].sort((a, b) =>
      new Date(a.date).getTime() - new Date(b.date).getTime()
    )

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]
      const curr = sorted[i]
      if (prev && curr) {
        const delta = curr.utilization - prev.utilization
        if (delta > 0) {
          dailyUsages.push(delta)
        }
      }
    }
  }

  if (dailyUsages.length === 0) {
    return null
  }

  const sum = dailyUsages.reduce((acc, val) => acc + val, 0)
  return sum / dailyUsages.length
}

/**
 * Get the last 7 days of usage history for charting.
 */
export const getRecentUsageHistory = (history: UsageHistory): UsageHistoryEntry[] => {
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

  return history.entries
    .filter(e => new Date(e.date) >= sevenDaysAgo)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
}

/**
 * Create an empty usage history.
 */
export const emptyUsageHistory = (): UsageHistory => ({
  entries: [],
  lastRecordedDate: null
})

// ============================================================================
// Service Definition
// ============================================================================

export class UsageService extends Effect.Service<UsageService>()("UsageService", {
  accessors: true,
  effect: Effect.succeed({
    getUsage,
    readOAuthToken,
    fetchUsageFromApi,
    clearUsageCache,
    isOAuthAvailable,
    serializeUsage,
    formatTimeUntilReset,
    recordUsageToHistory,
    calculateAvgDailyUsage,
    emptyUsageHistory
  })
}) {}
