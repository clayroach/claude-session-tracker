import { Effect, Data, Schema, Option } from "effect"
import { Command } from "@effect/platform"

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
const OAuthCredential = Schema.Struct({
  claudeAiOauth: Schema.optional(
    Schema.Struct({
      accessToken: Schema.String,
      refreshToken: Schema.optional(Schema.String),
      expiresAt: Schema.optional(Schema.String)
    })
  )
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

// ============================================================================
// Configuration
// ============================================================================

const KEYCHAIN_SERVICE = "Claude Code-credentials"
const USAGE_API_URL = "https://api.anthropic.com/api/oauth/usage"
const ANTHROPIC_BETA_HEADER = "oauth-2025-04-20"

// Cache configuration
const CACHE_TTL_MS = 60000 // 1 minute cache

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
 * Read OAuth token from macOS Keychain.
 */
export const readOAuthToken = Effect.gen(function* () {
  // Use security command to read from keychain
  const result = yield* Command.make(
    "security",
    "find-generic-password",
    "-s",
    KEYCHAIN_SERVICE,
    "-w"
  ).pipe(
    Command.string,
    Effect.mapError(() => new UsageError({
      operation: "readOAuthToken",
      message: "Failed to read OAuth token from keychain. Claude Code may not be authenticated."
    }))
  )

  const credentialJson = result.trim()
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
    formatTimeUntilReset
  })
}) {}
