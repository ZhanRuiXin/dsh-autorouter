import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeConfig } from '../src/config.js'
import { RouterState } from '../src/state.js'
import { attemptIdleFailure, createIdleGuard } from '../src/router/idle.js'
import { walkRoute } from '../src/router/walk.js'

const NOW = 1_760_000_000_000
const makeError = (message, code) => Object.assign(new Error(message), { code })

const INFO = {
  'a/m1': {
    inputModalities: ['text'],
    context: { contextWindow: 100_000 },
    reasoning: { efforts: [{ id: 'low' }, { id: 'high' }], defaultEffort: 'low' },
  },
  'b/m2': {
    inputModalities: ['text'],
    context: { contextWindow: 200_000 },
    reasoning: { efforts: [{ id: 'low' }] },
  },
}

const text = (value) => ({ type: 'text-delta', text: value })
const ok = () => ({ type: 'finish', reason: { kind: 'stop' } })
const fail = (code, status) => ({
  type: 'finish',
  reason: { kind: 'error', failure: { code, status, message: code } },
})

function fakeTimers() {
  let seq = 0
  const pending = new Map()
  return {
    schedule(handler, ms) {
      const id = (seq += 1)
      pending.set(id, { handler, ms })
      return id
    },
    cancel(id) {
      pending.delete(id)
    },
    fire() {
      const jobs = [...pending.entries()]
      pending.clear()
      for (const [, job] of jobs) job.handler()
    },
    get size() {
      return pending.size
    },
  }
}

test('the guard aborts an attempt only after the stream has been quiet for idleMs', () => {
  const timers = fakeTimers()
  const guard = createIdleGuard({ idleMs: 1000, schedule: timers.schedule, cancel: timers.cancel })
  assert.equal(guard.signal.aborted, false)
  assert.equal(guard.timedOut(), false)
  timers.fire()
  assert.equal(guard.signal.aborted, true)
  assert.equal(guard.timedOut(), true)
  guard.dispose()
})

test('touching the guard restarts the quiet window', () => {
  const timers = fakeTimers()
  const guard = createIdleGuard({ idleMs: 1000, schedule: timers.schedule, cancel: timers.cancel })
  guard.touch()
  assert.equal(timers.size, 1)
  assert.equal(guard.signal.aborted, false)
  timers.fire()
  assert.equal(guard.timedOut(), true)
  guard.dispose()
})

test('a host abort is relayed but never blamed on the route', () => {
  const timers = fakeTimers()
  const parent = new AbortController()
  const guard = createIdleGuard({ idleMs: 1000, parentSignal: parent.signal, schedule: timers.schedule, cancel: timers.cancel })
  parent.abort()
  assert.equal(guard.signal.aborted, true)
  assert.equal(guard.timedOut(), false)
  guard.dispose()
})

test('an idle timeout of zero keeps the guard off, and dispose takes the timer with it', () => {
  assert.equal(createIdleGuard({ idleMs: 0 }), undefined)
  const timers = fakeTimers()
  const guard = createIdleGuard({ idleMs: 1000, schedule: timers.schedule, cancel: timers.cancel })
  guard.dispose()
  assert.equal(timers.size, 0)
  assert.equal(guard.signal.aborted, false)
})

test('the idle failure is shaped like an adapter failure', () => {
  assert.deepEqual(attemptIdleFailure(1500), {
    code: 'NETWORK',
    message: 'AutoRouter: the attempt sent nothing for 1500ms and was aborted.',
  })
})

function makeConfig(policy = {}) {
  return normalizeConfig({
    enabled: true,
    profiles: [
      {
        id: 'p',
        name: 'P',
        chain: [
          { provider: 'a', model: 'm1' },
          { provider: 'b', model: 'm2' },
        ],
        policy: { cooldownMs: 60_000, maxSwitches: 4, attemptIdleMs: 20, ...policy },
      },
    ],
  })
}

/** A stream that accepts the request and then never yields, until aborted. */
function silent(options) {
  return (async function* () {
    if (options.signal?.aborted !== true) {
      await new Promise((resolve) => {
        options.signal?.addEventListener('abort', resolve, { once: true })
      })
    }
    throw Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })
  })()
}

function scripted(chunks) {
  return async function* () {
    for (const chunk of chunks) yield chunk
  }
}

async function collect(config, state, streamFn, options = {}) {
  const chunks = []
  for await (const chunk of walkRoute({
    options: {
      provider: 'autorouter',
      model: 'p',
      messages: [{ role: 'user', content: 'hi' }],
      sessionId: 'session-1',
      ...options,
    },
    profile: config.profiles[0],
    config,
    state,
    streamFn,
    infoOf: async (provider, model) => INFO[`${provider}/${model}`],
    makeError,
    now: () => NOW,
    random: () => 0.5,
  })) {
    chunks.push(chunk)
  }
  return chunks
}

test('an attempt that goes silent before any output hands the step to the next route', async () => {
  const config = makeConfig()
  const state = new RouterState({ now: () => NOW })
  const attempts = []
  const streamFn = (options) => {
    attempts.push(options)
    return attempts.length === 1 ? silent(options) : scripted([text('ok'), ok()])(options)
  }

  const chunks = await collect(config, state, streamFn)

  assert.equal(attempts.length, 2, 'the walk should have moved on')
  assert.equal(attempts[0].provider, 'a')
  assert.equal(attempts[1].provider, 'b')
  assert.equal(chunks.at(-1).reason.kind, 'stop')
  assert.equal(state.stats.switches, 1)
})

test('an attempt that goes silent after output cools the route and forwards the failure', async () => {
  const config = makeConfig()
  const state = new RouterState({ now: () => NOW })
  const attempts = []
  const streamFn = (options) => {
    attempts.push(options)
    if (attempts.length > 1) return scripted([text('later'), ok()])(options)
    return (async function* () {
      yield text('partial')
      yield* silent(options)
    })()
  }

  const chunks = await collect(config, state, streamFn)

  assert.equal(attempts.length, 1, 'committed output must not be replayed elsewhere')
  const ending = chunks.at(-1)
  assert.equal(ending.reason.kind, 'error')
  assert.match(ending.reason.failure.message, /sent nothing for 20ms/)

  // The next step must not start on the route that just died mid-answer.
  const second = []
  for await (const chunk of walkRoute({
    options: {
      provider: 'autorouter',
      model: 'p',
      messages: [{ role: 'user', content: 'again' }],
      sessionId: 'session-1',
    },
    profile: config.profiles[0],
    config,
    state,
    streamFn: (options) => {
      second.push(options)
      return scripted([text('ok'), ok()])(options)
    },
    infoOf: async (provider, model) => INFO[`${provider}/${model}`],
    makeError,
    now: () => NOW,
    random: () => 0.5,
  })) {
    // drain
  }
  assert.equal(second[0].provider, 'b')
})

test('a failure after output also cools the route for the next step', async () => {
  const config = makeConfig({ attemptIdleMs: 0 })
  const state = new RouterState({ now: () => NOW })
  const attempts = []
  const streamFn = (options) => {
    attempts.push(options)
    if (attempts.length > 1) return scripted([text('later'), ok()])(options)
    return scripted([text('partial'), fail('QUOTA', 429)])(options)
  }

  const chunks = await collect(config, state, streamFn)

  assert.equal(attempts.length, 1)
  assert.equal(chunks.at(-1).reason.kind, 'error')
  assert.equal(chunks.at(-1).reason.failure.code, 'QUOTA')

  const second = []
  for await (const chunk of walkRoute({
    options: { provider: 'autorouter', model: 'p', messages: [{ role: 'user', content: 'x' }], sessionId: 'session-1' },
    profile: config.profiles[0],
    config,
    state,
    streamFn: (options) => {
      second.push(options)
      return scripted([text('ok'), ok()])(options)
    },
    infoOf: async (provider, model) => INFO[`${provider}/${model}`],
    makeError,
    now: () => NOW,
    random: () => 0.5,
  })) {
    // drain
  }
  assert.equal(second[0].provider, 'b', 'the route that died mid-answer must be cooling')
})
