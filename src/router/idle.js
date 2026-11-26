/**
 * Per-attempt silence detector.
 *
 * A provider that accepts the connection and then stops sending is the one
 * failure mode a request-level timeout cannot see: the stream simply never
 * yields, so nothing is classified and the step hangs until the host gives up
 * or the user presses stop. This guard aborts the attempt after `idleMs`
 * without a chunk so the walk can treat it like any other network failure.
 */

/**
 * The failure an attempt is given when it went silent. Shaped like an adapter
 * failure so `classifyFailure` reads it the same way as an upstream error.
 *
 * @param {number} idleMs how long the attempt had been quiet
 * @returns {{code: string, message: string}}
 */
export function attemptIdleFailure(idleMs) {
  return {
    code: 'NETWORK',
    message: `AutoRouter: the attempt sent nothing for ${idleMs}ms and was aborted.`,
  }
}

/**
 * @param {object} [input]
 * @param {number} [input.idleMs]        zero or undefined leaves the guard off
 * @param {AbortSignal} [input.parentSignal] the host's signal for the call
 * @param {Function} [input.schedule]    injected for tests
 * @param {Function} [input.cancel]      injected for tests
 * @returns {undefined | {signal: AbortSignal, touch: () => void, dispose: () => void, timedOut: () => boolean}}
 */
export function createIdleGuard({ idleMs, parentSignal, schedule = setTimeout, cancel = clearTimeout } = {}) {
  if (!(typeof idleMs === 'number' && Number.isFinite(idleMs) && idleMs > 0)) return undefined

  const controller = new AbortController()
  let fired = false
  let timer

  function onParentAbort() {
    dispose()
    controller.abort()
  }

  function arm() {
    if (fired) return
    if (timer !== undefined) cancel(timer)
    timer = schedule(() => {
      fired = true
      timer = undefined
      controller.abort()
    }, idleMs)
    // An unref'd timer cannot hold a Node process open on its own.
    if (typeof timer === 'object' && timer !== null && typeof timer.unref === 'function') timer.unref()
  }

  function dispose() {
    if (timer !== undefined) {
      cancel(timer)
      timer = undefined
    }
    if (typeof parentSignal?.removeEventListener === 'function') {
      parentSignal.removeEventListener('abort', onParentAbort)
    }
  }

  if (parentSignal !== undefined && parentSignal !== null) {
    if (parentSignal.aborted === true) controller.abort()
    else if (typeof parentSignal.addEventListener === 'function') parentSignal.addEventListener('abort', onParentAbort, { once: true })
  }
  arm()

  return {
    signal: controller.signal,
    touch: arm,
    dispose,
    // `fired` stays false when the host aborted: that abort is the caller's
    // decision and must never be booked against the route.
    timedOut: () => fired,
  }
}
