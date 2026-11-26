/**
 * The routing walk: one virtual call becomes one or more upstream attempts.
 *
 * Rules (the same contract the incumbent fallback plugin implements, because
 * the harness relies on it):
 *  - a failure may advance the chain only before the first output chunk;
 *    `block-start` / text / reasoning / tool-call deltas commit the attempt,
 *  - `usage` chunks never commit, but are buffered and replayed so a failed
 *    attempt still reports what it spent,
 *  - after output is committed, a failure is forwarded untouched,
 *  - the fuse is `maxSwitches`, so attempts <= maxSwitches + 1.
 */

import { entryKey } from '../config.js'
import { classifyFailure, failureOf } from './classify.js'
import { mapEffort } from './effort.js'
import { attemptIdleFailure, createIdleGuard } from './idle.js'
import { orderCandidates, usability } from './select.js'

const OUTPUT_CHUNKS = new Set(['block-start', 'text-delta', 'reasoning-delta', 'tool-call-delta'])

function provenanceOf(replayState) {
  if (typeof replayState !== 'object' || replayState === null) return undefined
  const response = replayState.response
  if (typeof response !== 'object' || response === null) return undefined
  const { provider, model } = response
  if (typeof provider !== 'string' || provider === '') return undefined
  if (typeof model !== 'string' || model === '') return undefined
  return { provider, model }
}

/**
 * Assistant messages produced through AutoRouter carry `source.provider =
 * "autorouter"`. Nested adapters expect their own provenance (and their replay
 * state), so restore it when the envelope still knows where it came from.
 */
export function restoreProvenance(messages, providerId) {
  if (!Array.isArray(messages)) return messages
  let changed = false
  const restored = messages.map((message) => {
    const source = message?.source
    if (message?.role !== 'assistant' || source?.kind !== 'model' || source.provider !== providerId) return message
    const provenance = provenanceOf(source.replayState)
    if (provenance === undefined || provenance.provider === providerId) return message
    changed = true
    return { ...message, source: { ...source, provider: provenance.provider, model: provenance.model } }
  })
  return changed ? restored : messages
}

function failureChunk(failure) {
  return { type: 'finish', reason: { kind: 'error', failure } }
}

function cooldownFor(policy, entry, streak, verdict, random) {
  const base = Math.max(0, entry.cooldownMs > 0 ? entry.cooldownMs : policy.cooldownMs)
  let duration = base
  if (policy.recovery === 'half-open') {
    const escalations = Math.min(4, Math.max(0, streak - 1))
    duration = base * 2 ** escalations
  }
  if (verdict.retryAfterMs !== undefined && verdict.retryAfterMs > duration) duration = verdict.retryAfterMs
  const jitter = policy.cooldownJitterRatio ?? 0
  if (jitter > 0 && duration > 0) {
    duration = Math.round(duration * (1 + (random() - 0.5) * 2 * jitter))
  }
  return Math.max(0, duration)
}

/**
 * @param {object} input
 * @param {object} input.options      GenerateOptions for the virtual model
 * @param {object} input.profile      normalized profile (with policy)
 * @param {object} input.config       normalized config
 * @param {import('../state.js').RouterState} input.state
 * @param {(options: object) => AsyncIterable<object>} input.streamFn
 * @param {(provider: string, model: string, signal?: AbortSignal) => Promise<object | undefined>} input.infoOf
 * @param {(message: string, code: string) => Error} input.makeError
 * @param {() => number} [input.now]
 * @param {() => number} [input.random]
 * @param {{info?: Function, debug?: Function}} [input.log]
 */
export async function* walkRoute(input) {
  const {
    options,
    profile,
    config,
    state,
    streamFn,
    infoOf,
    makeError,
    now = Date.now,
    random = Math.random,
    log = {},
  } = input

  if (config.enabled !== true) {
    throw makeError('AutoRouter is disabled in Settings → AutoRouter.', 'AUTOROUTER_DISABLED')
  }
  if (profile.enabled !== true) {
    throw makeError(`AutoRouter: virtual model "${profile.id}" is disabled.`, 'PROFILE_DISABLED')
  }

  const policy = profile.policy
  const sessionId = options.sessionId
  const selection = orderCandidates({ profile, state, now: now(), sessionId })
  if (selection.candidates.length === 0) {
    const retryAt = selection.blocked
      .map((item) => item.until)
      .filter((value) => Number.isFinite(value) && value > now())
      .sort((left, right) => left - right)[0]
    const error = makeError(
      `AutoRouter: no healthy route for "${profile.id}" (${selection.blocked
        .map((item) => `${entryKey(item.entry)}: ${item.reason}`)
        .join(', ') || 'empty chain'}).`,
      'NO_HEALTHY_ROUTE',
    )
    if (retryAt !== undefined) error.providerRetryAfterMs = Math.max(0, retryAt - now())
    throw error
  }

  const messages = restoreProvenance(options.messages, options.provider)
  const candidates = selection.candidates
  let index = 0
  let switches = 0
  let lastFailure
  let repairedKey

  for (;;) {
    const entry = candidates[index]
    if (entry === undefined) {
      // The chain ran out before the fuse tripped: forward the last verdict so
      // the caller still gets a terminal finish chunk.
      if (lastFailure !== undefined) yield lastFailure
      return
    }
    const key = entryKey(entry)

    if (index > 0) {
      const verdict = usability(entry, state, policy, now())
      if (!verdict.usable) {
        index += 1
        continue
      }
    }

    let targetInfo
    try {
      targetInfo = await infoOf(entry.provider, entry.model, options.signal)
    } catch {
      targetInfo = undefined
    }
    // `null` means "the adapter says this model has no reasoning at all",
    // which is a different fact from "the lookup failed" (`undefined`).
    const targetReasoning = targetInfo === undefined ? undefined : (targetInfo.reasoning ?? null)
    const mapping = mapEffort(options.reasoningEffort, targetReasoning, entry.effortMap, policy)
    if (mapping.coerced) {
      log.info?.(
        `llm-autorouter: effort ${options.reasoningEffort} -> ${mapping.effort ?? '(omit)'} on ${key} (${mapping.reason})`,
      )
    }

    if (mapping.error !== undefined) {
      const failure = { message: mapping.error.message, code: 'UNSUPPORTED_REASONING_EFFORT' }
      lastFailure = failureChunk(failure)
      if (switches >= policy.maxSwitches) {
        yield lastFailure
        return
      }
      switches += 1
      state.stats.switches += 1
      index += 1
      continue
    }

    let attemptOptions = { ...options, provider: entry.provider, model: entry.model, messages }
    if (mapping.effort === undefined || repairedKey === key) {
      delete attemptOptions.reasoningEffort
    } else {
      attemptOptions.reasoningEffort = mapping.effort
    }

    // A stream that accepts the request and then goes quiet never reports a
    // failure, so each attempt carries its own silence detector on top of the
    // host signal. With `attemptIdleMs` at 0 the guard stays off.
    const guard = createIdleGuard({ idleMs: policy.attemptIdleMs, parentSignal: options.signal })
    if (guard !== undefined) attemptOptions.signal = guard.signal

    state.noteAttempt(key)
    let committed = false
    let pendingUsage = []
    let swallowed
    let retrySameTarget = false

    // Output already reached the caller, so this attempt cannot be replayed.
    // The route is still why the step died: book it so the next step does not
    // start there, and forward the failure untouched.
    const bookAfterCommit = (failure) => {
      const verdict = classifyFailure(failure, policy, { alreadyCommitted: false })
      const streak = state.recordFailure(key, now(), policy.failureWindowMs)
      if (verdict.retryable) {
        state.suppress(key, cooldownFor(policy, entry, streak, verdict, random), now(), {
          code: verdict.code,
          status: verdict.status,
          message: verdict.reason,
        })
      }
      state.setLastError({ key, code: verdict.code, status: verdict.status, message: verdict.reason, at: now() })
      const pin = state.session(sessionId, now(), policy.stickinessTtlMs)
      if (pin?.key === key) state.unpin(sessionId)
    }

    try {
      for await (const chunk of streamFn(attemptOptions)) {
        guard?.touch()

        if (chunk.type === 'usage') {
          if (committed) yield chunk
          else pendingUsage.push(chunk)
          continue
        }

        if (chunk.type === 'finish') {
          // The guard knows the attempt went silent even when the adapter only
          // reports the abort it received, so a silence verdict wins.
          const silent = guard?.timedOut() === true
          const failure = silent
            ? attemptIdleFailure(policy.attemptIdleMs)
            : chunk.reason?.kind === 'error'
              ? chunk.reason.failure
              : undefined
          if (failure !== undefined && !committed) {
            // One parameter repair per attempt: the upstream may simply not
            // know this effort, which is not a reason to abandon the route.
            if (
              failure.code === 'UNSUPPORTED_REASONING_EFFORT' &&
              attemptOptions.reasoningEffort !== undefined
            ) {
              attemptOptions = { ...attemptOptions }
              delete attemptOptions.reasoningEffort
              repairedKey = key
              pendingUsage = []
              retrySameTarget = true
              break
            }
            const verdict = classifyFailure(failure, policy, { alreadyCommitted: false })
            if (verdict.retryable || verdict.requestScoped) {
              swallowed = { chunk, verdict }
              break
            }
          }

          for (const pending of pendingUsage) yield pending
          if (failure === undefined) {
            if (chunk.reason?.kind !== 'aborted') {
              state.recordSuccess(key, now())
              if (policy.sticky === true) state.pin(sessionId, profile.id, key, now())
            }
          } else if (committed) {
            bookAfterCommit(failure)
          } else {
            state.recordFailure(key, now(), policy.failureWindowMs)
            state.setLastError({ key, code: failure.code, status: failure.status, message: failure.message, at: now() })
          }
          yield silent ? failureChunk(failure) : chunk
          return
        }

        for (const pending of pendingUsage) yield pending
        pendingUsage = []
        yield chunk
        if (OUTPUT_CHUNKS.has(chunk.type)) committed = true
      }
    } catch (error) {
      // A thrown error is a broken contract or a consumer failure, not a route
      // verdict. Only the walk's own pre-attempt errors are converted.
      if (guard?.timedOut() === true) {
        // The adapter surfaced the abort the guard raised; the reason is
        // silence, not whatever the abort surfaced as.
        const failure = attemptIdleFailure(policy.attemptIdleMs)
        if (committed) {
          bookAfterCommit(failure)
          yield failureChunk(failure)
          return
        }
        const verdict = classifyFailure(failure, policy, { alreadyCommitted: false })
        if (!verdict.retryable) {
          yield failureChunk(failure)
          return
        }
        swallowed = { chunk: failureChunk(failure), verdict }
      } else if (!committed) {
        const failure = failureOf(error)
        // The host rejects an effort the target does not declare before any
        // I/O, and it throws instead of yielding a finish chunk. That is the
        // same repair as below: drop the parameter, keep the route.
        if (failure.code === 'UNSUPPORTED_REASONING_EFFORT' && attemptOptions.reasoningEffort !== undefined) {
          attemptOptions = { ...attemptOptions }
          delete attemptOptions.reasoningEffort
          repairedKey = key
          pendingUsage = []
          retrySameTarget = true
        } else {
          const verdict = classifyFailure(failure, policy, { alreadyCommitted: false })
          if (verdict.retryable) {
            swallowed = { chunk: failureChunk(failure), verdict }
          } else {
            throw error
          }
        }
      } else {
        throw error
      }
    } finally {
      guard?.dispose()
    }

    if (retrySameTarget) continue

    if (swallowed === undefined) return

    lastFailure = swallowed.chunk
    // Usage the failed attempt already reported is real spend: replay it before
    // the next attempt so the host can account for it.
    for (const pending of pendingUsage) yield pending
    pendingUsage = []

    const streak = state.recordFailure(key, now(), policy.failureWindowMs)
    const cooldown = cooldownFor(policy, entry, streak, swallowed.verdict, random)
    if (!swallowed.verdict.requestScoped || policy.triggerCodes.includes(swallowed.verdict.code)) {
      state.suppress(key, cooldown, now(), {
        code: swallowed.verdict.code,
        status: swallowed.verdict.status,
        message: swallowed.verdict.reason,
      })
    }
    state.setLastError({
      key,
      code: swallowed.verdict.code,
      status: swallowed.verdict.status,
      message: swallowed.verdict.reason,
      at: now(),
    })
    const pin = state.session(sessionId, now(), policy.stickinessTtlMs)
    if (pin?.key === key) state.unpin(sessionId)

    if (switches >= policy.maxSwitches) {
      yield swallowed.chunk
      return
    }
    switches += 1
    state.stats.switches += 1
    log.debug?.(`llm-autorouter: ${key} failed (${swallowed.verdict.code}); trying the next route`)
    index += 1
  }
}
