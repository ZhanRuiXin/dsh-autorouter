/**
 * AutoRouter configuration: defaults, normalization and pure helpers.
 *
 * This module deliberately imports nothing from DSH so it can be unit-tested
 * with plain `node --test` outside the harness.
 */

export const PROVIDER_ID = 'autorouter'
export const PROVIDER_NAME = 'AutoRouter'
/** Profile-entry id / settings namespace. Must match bundle/cordis.patch.yml. */
export const ENTRY_ID = 'llm-autorouter'
export const CONFIG_VERSION = 1

export const DEFAULT_TRIGGER_CODES = ['AUTH', 'QUOTA', 'RATE_LIMIT']
export const DEFAULT_TRIGGER_STATUSES = [401, 402, 403, 408, 409, 425, 429, 500, 502, 503, 504, 529]

export const EFFORT_ORDER = ['off', 'minimal', 'low', 'medium', 'high', 'max']

export const DEFAULT_POLICY = {
  mode: 'balanced',
  sticky: true,
  stickinessTtlMs: 30 * 60 * 1000,
  maxSwitches: 8,
  cooldownMs: 5 * 60 * 1000,
  cooldownJitterRatio: 0.2,
  recovery: 'timer',
  triggerCodes: [...DEFAULT_TRIGGER_CODES],
  triggerStatuses: [...DEFAULT_TRIGGER_STATUSES],
  failureWindowMs: 2 * 60 * 1000,
  failureThreshold: 3,
  backoffBaseMs: 1000,
  backoffMaxMs: 15 * 1000,
  honorRetryAfter: true,
  retryOnNetwork: true,
  effortPolicy: 'clamp',
  contextPolicy: 'min',
  defaultContextWindow: 128000,
  timezone: 'Asia/Shanghai',
  utcOffsetMinutes: 480,
  timeWindows: [],
}

/**
 * The shipped chain. Every entry is a normal DSH route: one credential, one
 * model. "Key rotation" is expressed as several entries, because DSH binds one
 * credential per provider route.
 */
export const DEFAULT_PROFILE = {
  id: 'auto',
  name: 'Auto',
  aliases: [],
  enabled: true,
  description: 'One route: OpenDesign -> CommandCode -> DeepSeek, quota-aware.',
  chain: [
    {
      id: 'opendesign-flash-eco',
      enabled: true,
      provider: 'opendesign',
      model: 'deepseek-v4.1-flash-eco',
      label: 'OpenDesign · Flash Eco',
      weight: 1,
      costHint: 80,
      qualityHint: 40,
      cooldownMs: 5 * 60 * 1000,
      maxRequestsPerWindow: 0,
      maxTokensPerWindow: 0,
      windowMs: 24 * 60 * 60 * 1000,
      effortMap: {},
    },
    {
      id: 'commandcode-flash',
      enabled: true,
      provider: 'commandcode',
      model: 'deepseek/deepseek-v4.1-flash',
      label: 'CommandCode · Flash',
      weight: 1,
      costHint: 50,
      qualityHint: 60,
      cooldownMs: 5 * 60 * 1000,
      maxRequestsPerWindow: 0,
      maxTokensPerWindow: 0,
      windowMs: 24 * 60 * 60 * 1000,
      effortMap: {},
    },
    {
      id: 'deepseek-account-flash',
      enabled: true,
      provider: 'deepseek-account',
      model: 'deepseek-flash',
      label: 'DeepSeek · Flash',
      weight: 1,
      costHint: 20,
      qualityHint: 50,
      cooldownMs: 5 * 60 * 1000,
      maxRequestsPerWindow: 0,
      maxTokensPerWindow: 0,
      windowMs: 24 * 60 * 60 * 1000,
      effortMap: {},
    },
  ],
  policy: { ...DEFAULT_POLICY },
}

export const DEFAULT_CONFIG = {
  version: CONFIG_VERSION,
  enabled: true,
  debug: false,
  profiles: [DEFAULT_PROFILE],
  gateway: {
    enabled: false,
    /** Served model id -> profile id. Empty means "every enabled profile". */
    models: {},
  },
  service: {
    url: '',
    token: '',
    timeoutMs: 8000,
  },
}

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
const clone = (value) => (typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)))

function finiteNumber(value, fallback, { min = -Infinity, max = Infinity } = {}) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (typeof number !== 'number' || !Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
}

function boolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

function stringList(value, fallback) {
  if (!Array.isArray(value)) return [...fallback]
  const list = value.filter((item) => typeof item === 'string' && item.trim() !== '').map((item) => item.trim())
  return list.length > 0 ? [...new Set(list)] : [...fallback]
}

function statusList(value, fallback) {
  if (!Array.isArray(value)) return [...fallback]
  const list = value.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 100 && item <= 599)
  return list.length > 0 ? [...new Set(list)] : [...fallback]
}

/** `HH:MM` -> minutes since local midnight, or `undefined` when malformed. */
export function parseClock(value) {
  if (typeof value !== 'string') return undefined
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (match === null) return undefined
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return undefined
  return hours * 60 + minutes
}

function normalizeTimeWindow(raw, index) {
  if (!isObject(raw)) return undefined
  const from = parseClock(raw.from)
  const to = parseClock(raw.to)
  if (from === undefined || to === undefined) return undefined
  const id = text(raw.id, `window-${index + 1}`)
  return {
    id,
    label: text(raw.label, id),
    from,
    to,
    utcOffsetMinutes: finiteNumber(raw.utcOffsetMinutes, DEFAULT_POLICY.utcOffsetMinutes, { min: -720, max: 840 }),
    order: Array.isArray(raw.order)
      ? raw.order.filter((item) => typeof item === 'string' && item.trim() !== '').map((item) => item.trim())
      : [],
  }
}

function normalizeEffortMap(raw) {
  if (!isObject(raw)) return {}
  const map = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof key !== 'string' || key === '') continue
    if (value === null || value === false || value === '') {
      map[key] = null
    } else if (typeof value === 'string') {
      map[key] = value
    }
  }
  return map
}

function normalizeEntry(raw, index, seen) {
  if (!isObject(raw)) return undefined
  const provider = text(raw.provider)
  const model = text(raw.model)
  if (provider === '' || model === '' || provider === PROVIDER_ID) return undefined
  const key = `${provider}/${model}`
  if (seen.has(key)) return undefined
  seen.add(key)
  const id = text(raw.id, key).replace(/\s+/g, '-')
  return {
    id,
    enabled: boolean(raw.enabled, true),
    provider,
    model,
    label: text(raw.label, `${provider} · ${model}`),
    weight: finiteNumber(raw.weight, 1, { min: 1, max: 1000 }),
    costHint: finiteNumber(raw.costHint, 50, { min: 0, max: 100 }),
    qualityHint: finiteNumber(raw.qualityHint, 50, { min: 0, max: 100 }),
    cooldownMs: finiteNumber(raw.cooldownMs, DEFAULT_POLICY.cooldownMs, { min: 0, max: 7 * 24 * 60 * 60 * 1000 }),
    maxRequestsPerWindow: finiteNumber(raw.maxRequestsPerWindow, 0, { min: 0, max: 10_000_000 }),
    maxTokensPerWindow: finiteNumber(raw.maxTokensPerWindow, 0, { min: 0, max: 1_000_000_000 }),
    windowMs: finiteNumber(raw.windowMs, 24 * 60 * 60 * 1000, { min: 60_000, max: 31 * 24 * 60 * 60 * 1000 }),
    effortMap: normalizeEffortMap(raw.effortMap),
  }
}

function normalizePolicy(raw) {
  const source = isObject(raw) ? raw : {}
  const base = DEFAULT_POLICY
  const recovery = source.recovery === 'half-open' ? 'half-open' : 'timer'
  const mode = source.mode === 'efficiency' || source.mode === 'quality' ? source.mode : 'balanced'
  const effortPolicy = source.effortPolicy === 'drop' || source.effortPolicy === 'fail' ? source.effortPolicy : 'clamp'
  const contextPolicy = source.contextPolicy === 'fixed' ? 'fixed' : 'min'
  return {
    mode,
    sticky: boolean(source.sticky, base.sticky),
    stickinessTtlMs: finiteNumber(source.stickinessTtlMs, base.stickinessTtlMs, { min: 60_000, max: 24 * 60 * 60 * 1000 }),
    maxSwitches: Math.floor(finiteNumber(source.maxSwitches, base.maxSwitches, { min: 0, max: 32 })),
    cooldownMs: finiteNumber(source.cooldownMs, base.cooldownMs, { min: 0, max: 24 * 60 * 60 * 1000 }),
    cooldownJitterRatio: finiteNumber(source.cooldownJitterRatio, base.cooldownJitterRatio, { min: 0, max: 1 }),
    recovery,
    triggerCodes: stringList(source.triggerCodes, base.triggerCodes),
    triggerStatuses: statusList(source.triggerStatuses, base.triggerStatuses),
    failureWindowMs: finiteNumber(source.failureWindowMs, base.failureWindowMs, { min: 0, max: 24 * 60 * 60 * 1000 }),
    failureThreshold: Math.floor(finiteNumber(source.failureThreshold, base.failureThreshold, { min: 1, max: 100 })),
    backoffBaseMs: finiteNumber(source.backoffBaseMs, base.backoffBaseMs, { min: 0, max: 10 * 60 * 1000 }),
    backoffMaxMs: finiteNumber(source.backoffMaxMs, base.backoffMaxMs, { min: 0, max: 30 * 60 * 1000 }),
    honorRetryAfter: boolean(source.honorRetryAfter, base.honorRetryAfter),
    retryOnNetwork: boolean(source.retryOnNetwork, base.retryOnNetwork),
    effortPolicy,
    contextPolicy,
    defaultContextWindow: Math.floor(finiteNumber(source.defaultContextWindow, base.defaultContextWindow, { min: 8_000, max: 10_000_000 })),
    timezone: text(source.timezone, base.timezone),
    utcOffsetMinutes: Math.floor(finiteNumber(source.utcOffsetMinutes, base.utcOffsetMinutes, { min: -720, max: 840 })),
    timeWindows: Array.isArray(source.timeWindows)
      ? source.timeWindows.map((item, index) => normalizeTimeWindow(item, index)).filter((item) => item !== undefined)
      : [],
  }
}

function normalizeProfile(raw, index) {
  if (!isObject(raw)) return undefined
  const id = text(raw.id, index === 0 ? 'auto' : `profile-${index + 1}`)
  // Dedupe within this profile only: the same upstream route may legitimately
  // appear in more than one profile's chain.
  const seenEntryKeys = new Set()
  const chain = Array.isArray(raw.chain)
    ? raw.chain.map((entry, entryIndex) => normalizeEntry(entry, entryIndex, seenEntryKeys)).filter((entry) => entry !== undefined)
    : []
  return {
    id,
    name: text(raw.name, id === 'auto' ? 'Auto' : id),
    aliases: Array.isArray(raw.aliases)
      ? raw.aliases.filter((alias) => typeof alias === 'string' && alias.trim() !== '' && alias.trim() !== id).map((alias) => alias.trim())
      : [],
    enabled: boolean(raw.enabled, true),
    description: text(raw.description, ''),
    chain,
    policy: normalizePolicy(raw.policy),
  }
}

/**
 * Turn whatever the settings file / UI sent into a complete, bounded config.
 * Unknown keys are dropped on purpose: the wire format is the schema.
 */
export function normalizeConfig(raw, { fallback = DEFAULT_CONFIG } = {}) {
  const source = isObject(raw) ? raw : {}
  const profiles = Array.isArray(source.profiles) ? source.profiles : fallback.profiles
  const seenProfileIds = new Set()
  const normalizedProfiles = []
  for (const [index, profile] of profiles.entries()) {
    const next = normalizeProfile(profile, index)
    if (next === undefined) continue
    if (seenProfileIds.has(next.id)) continue
    seenProfileIds.add(next.id)
    normalizedProfiles.push(next)
  }
  const gateway = isObject(source.gateway) ? source.gateway : {}
  const service = isObject(source.service) ? source.service : {}
  return {
    version: CONFIG_VERSION,
    enabled: boolean(source.enabled, fallback.enabled),
    debug: boolean(source.debug, fallback.debug),
    profiles: normalizedProfiles.length > 0 ? normalizedProfiles : clone(DEFAULT_CONFIG.profiles),
    gateway: {
      enabled: boolean(gateway.enabled, false),
      models: isObject(gateway.models)
        ? Object.fromEntries(
            Object.entries(gateway.models).filter(
              ([key, value]) => keysAreText(key) && typeof value === 'string' && value.trim() !== '',
            ),
          )
        : {},
    },
    service: {
      url: text(service.url, ''),
      token: text(service.token, ''),
      timeoutMs: Math.floor(finiteNumber(service.timeoutMs, 8000, { min: 500, max: 120_000 })),
    },
  }
}

function keysAreText(key) {
  return typeof key === 'string' && key.trim() !== ''
}

/** Resolve a virtual model id (profile id or alias) to its profile. */
export function resolveProfile(config, model) {
  const id = typeof model === 'string' ? model.trim() : ''
  if (id === '') return undefined
  return config.profiles.find((profile) => profile.id === id || profile.aliases.includes(id))
}

export function routeKey(provider, model) {
  return `${provider}/${model}`
}

export function entryKey(entry) {
  return routeKey(entry.provider, entry.model)
}

export function enabledProfiles(config) {
  return config.profiles.filter((profile) => profile.enabled)
}

export function enabledEntries(profile) {
  return profile.chain.filter((entry) => entry.enabled)
}

/**
 * Fixed windows aligned to the local clock: for a day window and UTC+8 the
 * boundary is 00:00 Asia/Shanghai, for an hour window it is the top of the hour.
 */
export function windowIndexFor(now, windowMs, utcOffsetMinutes = 0) {
  const shifted = now + utcOffsetMinutes * 60_000
  return Math.floor(shifted / Math.max(60_000, windowMs))
}

export function secondsSinceWindowStart(now, windowMs, utcOffsetMinutes = 0) {
  const index = windowIndexFor(now, windowMs, utcOffsetMinutes)
  const start = index * Math.max(60_000, windowMs) - utcOffsetMinutes * 60_000
  return Math.max(0, now - start)
}

/** Minutes since local midnight for the given offset. */
export function localMinutes(now, utcOffsetMinutes) {
  const shifted = new Date(now + utcOffsetMinutes * 60_000)
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
}

export function timeWindowMatches(window, now) {
  const minutes = localMinutes(now, window.utcOffsetMinutes)
  if (window.from === window.to) return true
  if (window.from < window.to) return minutes >= window.from && minutes < window.to
  return minutes >= window.from || minutes < window.to
}

/** The first matching time window in config order, or `undefined`. */
export function activeTimeWindow(policy, now) {
  return (policy.timeWindows ?? []).find((window) => timeWindowMatches(window, now))
}

/**
 * Reorder a chain for the active time window. Entries named in `order` come
 * first in that order; the rest keep their configured order.
 */
export function applyTimeWindow(entries, window) {
  if (window === undefined) return entries
  const rank = new Map(window.order.map((id, index) => [id, index]))
  return [...entries].sort((left, right) => {
    const leftRank = rank.get(left.id)
    const rightRank = rank.get(right.id)
    if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank
    if (leftRank !== undefined) return -1
    if (rightRank !== undefined) return 1
    return 0
  })
}

export function isEntryEligible(entry) {
  return entry.enabled && entry.provider !== PROVIDER_ID && typeof entry.model === 'string' && entry.model !== ''
}
