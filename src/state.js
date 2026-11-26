/**
 * In-memory routing state: per-session stickiness, cooldowns, failure streaks,
 * fixed-window budgets and counters. Nothing here is persisted: a restart
 * clears every cooldown, which is the behaviour we want after a config change.
 */

import { windowIndexFor, secondsSinceWindowStart, entryKey } from './config.js'

const HOUR = 60 * 60 * 1000

export class RouterState {
  constructor({ now = Date.now, maxSessions = 1024 } = {}) {
    this.now = now
    this.maxSessions = maxSessions
    this.sessions = new Map()
    this.cooldowns = new Map()
    this.budgets = new Map()
    this.failures = new Map()
    this.stats = {
      startedAt: now(),
      attempts: 0,
      successes: 0,
      failures: 0,
      switches: 0,
      lastRoute: undefined,
      lastError: undefined,
    }
  }

  // ---- sessions ---------------------------------------------------------

  session(sessionId, now = this.now(), ttlMs = 30 * 60 * 1000) {
    if (typeof sessionId !== 'string' || sessionId === '') return undefined
    const record = this.sessions.get(sessionId)
    if (record === undefined) return undefined
    if (now - record.at > ttlMs) {
      this.sessions.delete(sessionId)
      return undefined
    }
    return record
  }

  pin(sessionId, profileId, key, now = this.now()) {
    if (typeof sessionId !== 'string' || sessionId === '') return
    this.sessions.delete(sessionId)
    this.sessions.set(sessionId, { profileId, key, at: now })
    if (this.sessions.size > this.maxSessions) {
      const oldest = this.sessions.keys().next().value
      if (oldest !== undefined) this.sessions.delete(oldest)
    }
  }

  unpin(sessionId) {
    if (typeof sessionId === 'string') this.sessions.delete(sessionId)
  }

  touch(sessionId, now = this.now()) {
    const record = typeof sessionId === 'string' ? this.sessions.get(sessionId) : undefined
    if (record !== undefined) record.at = now
  }

  // ---- cooldowns --------------------------------------------------------

  coolingUntil(key) {
    return this.cooldowns.get(key)?.until ?? 0
  }

  isCooling(key, now = this.now()) {
    return this.coolingUntil(key) > now
  }

  suppress(key, durationMs, now = this.now(), meta = {}) {
    const until = Math.max(this.coolingUntil(key), now + Math.max(0, durationMs))
    this.cooldowns.set(key, { ...this.cooldowns.get(key), ...meta, until, at: now })
    return until
  }

  clearCooldown(key) {
    this.cooldowns.delete(key)
  }

  // ---- failure streaks --------------------------------------------------

  failureStreak(key, now = this.now(), windowMs = 2 * 60 * 1000) {
    const record = this.failures.get(key)
    if (record === undefined) return 0
    if (now - record.lastAt > windowMs) {
      this.failures.delete(key)
      return 0
    }
    return record.count
  }

  recordFailure(key, now = this.now(), windowMs = 2 * 60 * 1000) {
    const previous = this.failures.get(key)
    const fresh = previous === undefined || now - previous.lastAt > windowMs
    const count = fresh ? 1 : previous.count + 1
    this.failures.set(key, { count, lastAt: now })
    this.stats.failures += 1
    return count
  }

  recordSuccess(key, now = this.now()) {
    this.failures.delete(key)
    this.clearCooldown(key)
    this.stats.successes += 1
    this.stats.lastRoute = key
    this.stats.lastError = undefined
    return now
  }

  // ---- budgets ----------------------------------------------------------

  budget(key, entry, now = this.now(), utcOffsetMinutes = 0) {
    const windowMs = entry.windowMs
    const index = windowIndexFor(now, windowMs, utcOffsetMinutes)
    let record = this.budgets.get(key)
    if (record === undefined || record.index !== index || record.windowMs !== windowMs) {
      record = { index, windowMs, requests: 0, tokens: 0 }
      this.budgets.set(key, record)
    }
    const requestLimit = entry.maxRequestsPerWindow
    const tokenLimit = entry.maxTokensPerWindow
    const exhausted =
      (requestLimit > 0 && record.requests >= requestLimit) || (tokenLimit > 0 && record.tokens >= tokenLimit)
    return {
      requests: record.requests,
      tokens: record.tokens,
      requestLimit,
      tokenLimit,
      exhausted,
      resetInMs:
        requestLimit > 0 || tokenLimit > 0
          ? Math.max(0, windowMs - secondsSinceWindowStart(now, windowMs, utcOffsetMinutes))
          : 0,
    }
  }

  noteAttempt(key, entry, now = this.now(), utcOffsetMinutes = 0) {
    this.budget(key, entry, now, utcOffsetMinutes)
    const record = this.budgets.get(key)
    if (record !== undefined) record.requests += 1
    this.stats.attempts += 1
    this.stats.lastRoute = key
  }

  noteUsage(key, usage, entry, now = this.now(), utcOffsetMinutes = 0) {
    if (usage === undefined || usage === null) return
    const tokens =
      Number(usage.totalTokens ?? 0) ||
      Number(usage.inputTokens ?? 0) + Number(usage.outputTokens ?? 0) + Number(usage.reasoningTokens ?? 0)
    if (!Number.isFinite(tokens) || tokens <= 0) return
    this.budget(key, entry, now, utcOffsetMinutes)
    const record = this.budgets.get(key)
    if (record !== undefined) record.tokens += tokens
  }


  // ---- bookkeeping ------------------------------------------------------

  prune(now = this.now(), { sessionTtlMs = 30 * 60 * 1000, cooldownGraceMs = HOUR } = {}) {
    for (const [key, record] of this.sessions) {
      if (now - record.at > sessionTtlMs) this.sessions.delete(key)
    }
    for (const [key, record] of this.cooldowns) {
      if (record.until + cooldownGraceMs < now) this.cooldowns.delete(key)
    }
    for (const [key, record] of this.failures) {
      if (now - record.lastAt > HOUR) this.failures.delete(key)
    }
    if (this.budgets.size > 4096) {
      for (const [key, record] of this.budgets) {
        if (now - (record.index * record.windowMs) > 7 * 24 * HOUR) this.budgets.delete(key)
      }
    }
  }

  setLastError(error) {
    this.stats.lastError = error
  }

  /**
   * Serializable view for the settings page. Contains no prompts, no message
   * bodies and no credentials — only route ids and counters.
   */
  snapshot(config, now = this.now(), utcOffsetMinutes = 0) {
    const routes = []
    for (const profile of config.profiles) {
      for (const entry of profile.chain) {
        const key = entryKey(entry)
        const budget = this.budget(key, entry, now, utcOffsetMinutes)
        routes.push({
          profileId: profile.id,
          entryId: entry.id,
          key,
          provider: entry.provider,
          model: entry.model,
          label: entry.label,
          enabled: entry.enabled,
          coolingUntil: this.coolingUntil(key) || undefined,
          failures: this.failureStreak(key, now),
          budget: {
            requests: budget.requests,
            tokens: budget.tokens,
            requestLimit: budget.requestLimit,
            tokenLimit: budget.tokenLimit,
            exhausted: budget.exhausted,
            resetInMs: budget.resetInMs,
          },
        })
      }
    }
    return {
      at: now,
      stats: { ...this.stats },
      routes,
      sessions: [...this.sessions].map(([sessionId, record]) => ({
        sessionId,
        profileId: record.profileId,
        key: record.key,
        ageMs: now - record.at,
      })),
    }
  }
}
