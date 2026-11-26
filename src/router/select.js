/**
 * Candidate selection: cooldowns, fixed-window budgets, time windows, sticky
 * sessions and weighted rotation. Pure apart from the RouterState it reads and
 * advances (the cursor), which is the point: it is unit-testable.
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

function rotateWeighted(entries, cursor) {
  const total = entries.reduce((sum, entry) => sum + Math.max(1, entry.weight), 0)
  let index = Math.max(0, cursor) % Math.max(1, total)
  for (let position = 0; position < entries.length; position += 1) {
    index -= Math.max(1, entries[position].weight)
    if (index < 0) return [...entries.slice(position), ...entries.slice(0, position)]
  }
  return [...entries]
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

  let ordered = candidates
  if (policy.mode === 'efficiency') {
    ordered = [...candidates].sort((left, right) => left.costHint - right.costHint || left.weight - right.weight)
  } else if (policy.mode === 'quality') {
    ordered = [...candidates].sort((left, right) => right.qualityHint - left.qualityHint || left.weight - right.weight)
  } else if (candidates.length > 1) {
    const total = candidates.reduce((sum, entry) => sum + Math.max(1, entry.weight), 0)
    ordered = rotateWeighted(candidates, state.nextCursor(profile.id, total))
  }

  // A time window is a routing seed, not a filter: it moves the named routes to
  // the front but keeps the mode's ordering inside each group. Applying it last
  // means the mode sort cannot cancel it.
  if (window !== undefined) ordered = applyTimeWindow(ordered, window)

  // Stickiness wins over the ordering mode: the pinned route goes first so the
  // prompt cache survives, and the rest of the chain stays intact behind it.
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
