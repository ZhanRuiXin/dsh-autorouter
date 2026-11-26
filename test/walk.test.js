import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeConfig } from '../src/config.js'
import { RouterState } from '../src/state.js'
import { restoreProvenance, walkRoute } from '../src/router/walk.js'

const NOW = 1_760_000_000_000
const makeError = (message, code) => Object.assign(new Error(message), { code })

const INFO = {
  'a/m1': {
    inputModalities: ['text', 'image'],
    context: { contextWindow: 100_000 },
    reasoning: { efforts: [{ id: 'low' }, { id: 'high' }], defaultEffort: 'low' },
  },
  'b/m2': {
    inputModalities: ['text'],
    context: { contextWindow: 200_000 },
    reasoning: { efforts: [{ id: 'max' }] },
  },
}

const text = (value) => ({ type: 'text-delta', text: value })
const usage = (input, output) => ({ type: 'usage', usage: { inputTokens: input, outputTokens: output } })
const ok = () => ({ type: 'finish', reason: { kind: 'stop' } })
const fail = (code, status) => ({
  type: 'finish',
  reason: { kind: 'error', failure: { code, status, message: code } },
})

function makeConfig(overrides = {}) {
  return normalizeConfig({
    enabled: true,
    profiles: [
      {
        id: 'p',
        name: 'P',
        chain: [
          { provider: 'a', model: 'm1', qualityHint: 90, costHint: 80 },
          { provider: 'b', model: 'm2', qualityHint: 10, costHint: 10 },
        ],
        policy: { mode: 'quality', cooldownMs: 60_000, recovery: 'timer' },
        ...overrides,
      },
    ],
  })
}

function harness(script) {
  const attempts = []
  let call = 0
  return {
    attempts,
    streamFn(options) {
      attempts.push({ ...options })
      const chunks = script[Math.min(call, script.length - 1)]
      call += 1
      return (async function* () {
        for (const chunk of chunks) yield chunk
      })()
    },
  }
}

function run(walk, options = {}) {
  return walkRoute({
    options: {
      provider: 'autorouter',
      model: 'p',
      messages: [{ role: 'user', content: 'hi' }],
      sessionId: 'session-1',
      ...options,
    },
    profile: walk.config.profiles[0],
    config: walk.config,
    state: walk.state,
    streamFn: walk.streamFn,
    infoOf: async (provider, model) => INFO[`${provider}/${model}`],
    makeError,
    now: () => NOW,
    random: () => 0.5,
  })
}

async function collect(iterator) {
  const chunks = []
  for await (const chunk of iterator) chunks.push(chunk)
  return chunks
}

function setup(script, overrides) {
  const config = makeConfig(overrides)
  const state = new RouterState({ now: () => NOW })
  return { config, state, ...harness(script) }
}

test('pre-output failure advances to the next route', async () => {
  const walk = setup([[fail('QUOTA', 429)], [text('ok'), ok()]])
  const chunks = await collect(run(walk))

  assert.deepEqual(
    walk.attempts.map((attempt) => `${attempt.provider}/${attempt.model}`),
    ['a/m1', 'b/m2'],
  )
  assert.equal(chunks.at(-1).reason.kind, 'stop')
  assert.equal(chunks.find((chunk) => chunk.type === 'text-delta').text, 'ok')
  assert.equal(walk.state.isCooling('a/m1', NOW), true)
  assert.equal(walk.state.stats.switches, 1)
})

test('failure after output is forwarded without switching', async () => {
  const walk = setup([[text('partial'), fail('QUOTA', 429)], [text('wrong'), ok()]])
  const chunks = await collect(run(walk))

  assert.equal(walk.attempts.length, 1)
  assert.equal(chunks[0].text, 'partial')
  assert.equal(chunks.at(-1).reason.kind, 'error')
  assert.equal(chunks.at(-1).reason.failure.code, 'QUOTA')
})

test('usage from a failed attempt is replayed before the switch', async () => {
  const walk = setup([[usage(12, 3), fail('QUOTA', 429)], [text('ok'), ok()]])
  const chunks = await collect(run(walk))

  const usageIndex = chunks.findIndex((chunk) => chunk.type === 'usage')
  const textIndex = chunks.findIndex((chunk) => chunk.type === 'text-delta')
  assert.notEqual(usageIndex, -1)
  assert.ok(usageIndex < textIndex)
})

test('running out of candidates still yields a terminal failure', async () => {
  const walk = setup([[fail('QUOTA', 429)], [fail('RATE_LIMIT', 429)]])
  const chunks = await collect(run(walk))

  assert.equal(walk.attempts.length, 2)
  assert.equal(chunks.at(-1).type, 'finish')
  assert.equal(chunks.at(-1).reason.kind, 'error')
})

test('maxSwitches 0 stops after the first failure', async () => {
  const walk = setup([[fail('QUOTA', 429)], [text('ok'), ok()]], { policy: { maxSwitches: 0 } })
  const chunks = await collect(run(walk))

  assert.equal(walk.attempts.length, 1)
  assert.equal(chunks.at(-1).reason.failure.code, 'QUOTA')
})

test('effort is clamped per target and inherited by a capable one', async () => {
  const walk = setup([[fail('QUOTA', 429)], [text('ok'), ok()]])
  await collect(run(walk, { reasoningEffort: 'max' }))

  assert.equal(walk.attempts[0].reasoningEffort, 'low')
  assert.equal(walk.attempts[1].reasoningEffort, 'max')
})

test('an explicit effort map can drop a parameter', async () => {
  const config = makeConfig()
  config.profiles[0].chain[0].effortMap = { max: null }
  const state = new RouterState({ now: () => NOW })
  const walk = { config, state, ...harness([[fail('QUOTA', 429)], [text('ok'), ok()]]) }

  await collect(run(walk, { reasoningEffort: 'max' }))
  assert.equal('reasoningEffort' in walk.attempts[0], false)
  assert.equal(walk.attempts[1].reasoningEffort, 'max')
})

test('UNSUPPORTED_REASONING_EFFORT retries the same target without the parameter', async () => {
  const walk = setup([[fail('UNSUPPORTED_REASONING_EFFORT')], [text('ok'), ok()]])
  const chunks = await collect(run(walk, { reasoningEffort: 'max' }))

  assert.equal(walk.attempts.length, 2)
  assert.equal(walk.attempts[0].provider, 'a')
  assert.equal(walk.attempts[1].provider, 'a')
  assert.equal('reasoningEffort' in walk.attempts[1], false)
  assert.equal(chunks.at(-1).reason.kind, 'stop')
})

test('assistant provenance is restored for the nested adapter', async () => {
  const walk = setup([[text('ok'), ok()]])
  const messages = [
    {
      role: 'assistant',
      content: 'previous',
      source: {
        kind: 'model',
        provider: 'autorouter',
        model: 'p',
        replayState: { response: { provider: 'a', model: 'm1' } },
      },
    },
  ]
  await collect(run(walk, { messages }))
  assert.equal(walk.attempts[0].messages[0].source.provider, 'a')
  assert.equal(walk.attempts[0].messages[0].source.model, 'm1')
  assert.equal(walk.attempts[0].messages[0].source.replayState.response.provider, 'a')
})

test('restoreProvenance leaves foreign sources untouched', () => {
  const messages = [
    { role: 'assistant', source: { kind: 'model', provider: 'other', model: 'x' } },
    { role: 'user', content: 'hi' },
  ]
  assert.equal(restoreProvenance(messages, 'autorouter'), messages)
})

test('a pinned session starts on its sticky route', async () => {
  const walk = setup([[text('b'), ok()]])
  walk.state.pin('session-1', 'p', 'b/m2', NOW)
  await collect(run(walk))
  assert.equal(walk.attempts[0].provider, 'b')
})

test('disabled config, disabled profile and exhausted chain are rejected', async () => {
  const disabled = setup([[text('x'), ok()]])
  disabled.config.enabled = false
  await assert.rejects(collect(run(disabled)), (error) => error.code === 'AUTOROUTER_DISABLED')

  const profileOff = setup([[text('x'), ok()]])
  profileOff.config.profiles[0].enabled = false
  await assert.rejects(collect(run(profileOff)), (error) => error.code === 'PROFILE_DISABLED')

  const empty = setup([[text('x'), ok()]], { chain: [] })
  await assert.rejects(collect(run(empty)), (error) => error.code === 'NO_HEALTHY_ROUTE')

  const cooling = setup([[text('x'), ok()]])
  cooling.state.suppress('a/m1', 60_000, NOW)
  cooling.state.suppress('b/m2', 60_000, NOW)
  await assert.rejects(collect(run(cooling)), (error) => {
    assert.equal(error.code, 'NO_HEALTHY_ROUTE')
    assert.ok(error.providerRetryAfterMs > 0)
    return true
  })
})
