/**
 * Reasoning-effort inheritance.
 *
 * The virtual model advertises the union of the efforts its chain can accept,
 * so a caller asking for `max` keeps working even when one upstream only knows
 * `high`. Each attempt then maps the requested effort onto what the target
 * actually declares. `llm.resolveCallConfig` refuses an effort the *virtual*
 * model does not advertise, so the union is what keeps the request alive; the
 * per-target mapping is what keeps the upstream from rejecting it.
 */

import { EFFORT_ORDER } from '../config.js'

const RANK = new Map(EFFORT_ORDER.map((id, index) => [id, index]))

export function sortEfforts(efforts) {
  return [...efforts].sort((left, right) => {
    const leftRank = RANK.get(left.id)
    const rightRank = RANK.get(right.id)
    if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank
    if (leftRank !== undefined) return -1
    if (rightRank !== undefined) return 1
    return 0
  })
}

/**
 * @param {Array<{efforts?: Array<{id: string, name?: string}>, defaultEffort?: string}>} infos
 * @returns {{efforts: Array<{id: string, name: string}>, defaultEffort?: string} | undefined}
 */
export function unionEfforts(infos) {
  const byId = new Map()
  let declared = false
  let defaultEffort
  for (const info of infos) {
    if (info === undefined || info === null) continue
    const efforts = info.efforts
    if (!Array.isArray(efforts)) continue
    declared = true
    for (const effort of efforts) {
      const id = typeof effort?.id === 'string' ? effort.id : undefined
      if (id === undefined || id === '' || byId.has(id)) continue
      byId.set(id, { id, name: typeof effort.name === 'string' && effort.name !== '' ? effort.name : id })
    }
    if (typeof info.defaultEffort === 'string' && byId.has(info.defaultEffort)) defaultEffort = info.defaultEffort
  }
  // An upstream that declares an empty list is not evidence of "no reasoning",
  // and the host refuses an advertised model with zero efforts. Say nothing.
  if (!declared || byId.size === 0) return undefined
  return {
    efforts: sortEfforts([...byId.values()]),
    ...(defaultEffort === undefined ? {} : { defaultEffort }),
  }
}

/**
 * Map one requested effort onto one target.
 *
 * @param {string | undefined} requested
 * @param {{efforts?: Array<{id: string}>, defaultEffort?: string} | undefined} target
 * @param {Record<string, string | null>} effortMap
 * @param {{effortPolicy?: 'clamp' | 'drop' | 'fail'}} policy
 * @returns {{effort?: string, coerced: boolean, reason: string, error?: Error}}
 */
export function mapEffort(requested, target, effortMap = {}, policy = {}) {
  if (requested === undefined || requested === null || requested === '') {
    return { effort: undefined, coerced: false, reason: 'inherit-none' }
  }
  if (Object.prototype.hasOwnProperty.call(effortMap, requested)) {
    const mapped = effortMap[requested]
    if (mapped === null || mapped === '') {
      return { effort: undefined, coerced: true, reason: `mapped-off:${requested}` }
    }
    return { effort: mapped, coerced: mapped !== requested, reason: `mapped:${requested}->${mapped}` }
  }
  const efforts = target?.efforts
  if (target === null) {
    // The adapter already reported this model with no reasoning metadata at
    // all. The host refuses an explicit effort for such a model before the
    // request leaves the process, so passing it through cannot work.
    const mode = policy.effortPolicy ?? 'clamp'
    if (mode === 'fail') {
      return {
        effort: undefined,
        coerced: true,
        reason: `unsupported:${requested}`,
        error: Object.assign(new Error(`AutoRouter: the target declares no reasoning efforts`), {
          code: 'UNSUPPORTED_REASONING_EFFORT',
        }),
      }
    }
    return { effort: undefined, coerced: true, reason: `no-reasoning:${requested}` }
  }
  if (!Array.isArray(efforts)) {
    // No metadata could be read at all: an unknown upstream is not evidence
    // that it rejects the parameter, so the request goes out as asked.
    return { effort: requested, coerced: false, reason: 'target-unknown' }
  }
  if (efforts.length === 0) {
    const mode = policy.effortPolicy ?? 'clamp'
    if (mode === 'fail') {
      return {
        effort: undefined,
        coerced: true,
        reason: `unsupported:${requested}`,
        error: Object.assign(new Error(`AutoRouter: the target declares no reasoning efforts`), {
          code: 'UNSUPPORTED_REASONING_EFFORT',
        }),
      }
    }
    return { effort: undefined, coerced: true, reason: `no-reasoning:${requested}` }
  }
  if (efforts.some((effort) => effort?.id === requested)) {
    return { effort: requested, coerced: false, reason: 'exact' }
  }
  const fallback = target?.defaultEffort
  if (typeof fallback === 'string' && fallback !== '' && efforts.some((effort) => effort?.id === fallback)) {
    if ((policy.effortPolicy ?? 'clamp') === 'fail') {
      return {
        effort: undefined,
        coerced: true,
        reason: `unsupported:${requested}`,
        error: Object.assign(new Error(`AutoRouter: target does not support reasoning effort "${requested}"`), {
          code: 'UNSUPPORTED_REASONING_EFFORT',
        }),
      }
    }
    return { effort: fallback, coerced: true, reason: `clamped:${requested}->${fallback}` }
  }
  const mode = policy.effortPolicy ?? 'clamp'
  if (mode === 'fail') {
    return {
      effort: undefined,
      coerced: true,
      reason: `unsupported:${requested}`,
      error: Object.assign(new Error(`AutoRouter: target does not support reasoning effort "${requested}"`), {
        code: 'UNSUPPORTED_REASONING_EFFORT',
      }),
    }
  }
  return { effort: undefined, coerced: true, reason: `dropped:${requested}` }
}
