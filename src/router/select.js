/**
 * Candidate selection: cooldowns, fixed-window budgets, time windows and sticky
 * sessions. The chain is tried strictly in its configured order; a matching
 * time window may rotate which routes come first, but never filters and never
 * sorts by cost or quality.
 */

import {
  activeTimeWindow,
  applyTimeWindow,
  enabledEntries,
  entryKey,
  isEntryEligible,
} from '../config.js'

/** @returns {{usable: boolean, reason?: string, until?: number, resetInMs?: number}} */
export function usability(entry, state, policy, now, utcOffsetMinutes) {
  if (!isEntryEligible(entry)) return { usable: false, reason: 'invalid-entry' }
  const key = entryKey(entry)
  const until = state.coolingUntil(key)
  if (until > now) return { usable: false, reason: 'cooldown', until }
  const budget = state.budget(key, entry, now, utcOffsetMinutes)
  if (budget.exhausted) return { usable: false, reason: 'budget', resetInMs: budget.resetInMs }
  return { usable: true }
}

/**
 * Build the attempt order for one virtual call.
 *
 * @returns {{
 *   candidates: object[],
 *   blocked: Array<{entry: object, reason: string, until?: number, resetInMs?: number}>,
 *   window: object | undefined,
 *   sticky: boolean,
 *   order: string[],
 * }}
 */
export function orderCandidates({ profile, state, now = Date.now(), sessionId }) {
  const policy = profile.policy
  const configured = enabledEntries(profile).filter(isEntryEligible)
  const window = activeTimeWindow(policy, now)

  const candidates = []
  const blocked = []
  for (const entry of configured) {
    const verdict = usability(entry, state, policy, now, policy.utcOffsetMinutes)
    if (verdict.usable) {
      candidates.push(entry)
    } else {
      blocked.push({ entry, reason: verdict.reason, until: verdict.until, resetInMs: verdict.resetInMs })
    }
  }

  let sticky = false
  let pinnedKey
  if (policy.sticky === true && candidates.length > 1) {
    const pin = state.session(sessionId, now, policy.stickinessTtlMs)
    if (pin !== undefined && pin.profileId === profile.id && candidates.some((entry) => entryKey(entry) === pin.key)) {
      pinnedKey = pin.key
      sticky = true
    }
  }

  // Chain order is the baseline. A time window is a routing seed, not a
  // filter: it moves the named routes to the front and keeps everything else
  // in its original relative order behind them.
  let ordered = candidates
  if (window !== undefined) ordered = applyTimeWindow(ordered, window)

  // Stickiness wins over the window: the pinned route goes first so the prompt
  // cache survives, and the rest of the chain stays intact behind it.
  if (pinnedKey !== undefined) {
    const index = ordered.findIndex((entry) => entryKey(entry) === pinnedKey)
    if (index > 0) {
      const next = [...ordered]
      const [pinned] = next.splice(index, 1)
      next.unshift(pinned)
      ordered = next
    }
  }

  return {
    candidates: ordered,
    blocked,
    window,
    sticky,
    order: ordered.map(entryKey),
  }
}

export function nextCandidate(candidates, fromKey) {
  const index = candidates.findIndex((entry) => entryKey(entry) === fromKey)
  if (index < 0) return undefined
  return candidates[index + 1]
}

export function firstCandidate(candidates) {
  return candidates[0]
}

/** Small human-readable summary for logs and the status route. */
export function describeOrder(selection) {
  return {
    window: selection.window?.label,
    sticky: selection.sticky,
    candidates: selection.order,
    blocked: selection.blocked.map((item) => `${entryKey(item.entry)} (${item.reason})`),
  }
}
