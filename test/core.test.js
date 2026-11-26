import assert from 'node:assert/strict'
import test from 'node:test'

import { activeTimeWindow, applyTimeWindow, matchSettingsEntry, normalizeConfig, resolveProfile, entryKey } from '../src/config.js'
import { mapEffort, unionEfforts } from '../src/router/effort.js'
import { classifyFailure } from '../src/router/classify.js'
import { resolveProfileInfo, toModelInfo } from '../src/router/model-info.js'
import { orderCandidates } from '../src/router/select.js'
import { RouterState } from '../src/state.js'

const NOW = 1_760_000_000_000

function profileOf(raw, index = 0) {
  return normalizeConfig(raw).profiles[index]
}

test('normalizeConfig fills defaults and bounds numbers', () => {
  const config = normalizeConfig({})
  assert.equal(config.enabled, true)
  assert.equal(config.profiles.length, 1)
  const profile = config.profiles[0]
  assert.equal(profile.id, 'auto')
  assert.equal(profile.name, 'Auto')
  assert.equal(profile.chain.length, 3)
  assert.equal(profile.policy.maxSwitches, 8)
  assert.equal(profile.policy.effortPolicy, 'clamp')

  const bounded = normalizeConfig({
    profiles: [{ id: 'p', chain: [], policy: { maxSwitches: 999, cooldownMs: -5, stickinessTtlMs: 1, defaultContextWindow: 10 } }],
  }).profiles[0]
  assert.equal(bounded.policy.maxSwitches, 32)
  assert.equal(bounded.policy.cooldownMs, 0)
  assert.equal(bounded.policy.stickinessTtlMs, 60_000)
  assert.equal(bounded.policy.defaultContextWindow, 8_000)
})

test('normalizeConfig drops invalid and self-referential entries', () => {
  const profile = profileOf({
    profiles: [
      {
        id: 'p',
        chain: [
          { provider: 'autorouter', model: 'auto' },
          { provider: 'a', model: '' },
          { provider: 'a', model: 'm' },
          { provider: 'a', model: 'm' },
        ],
      },
    ],
  })
  assert.equal(profile.chain.length, 1)
  assert.equal(entryKey(profile.chain[0]), 'a/m')
})

test('the same upstream route may appear in two profiles', () => {
  const config = normalizeConfig({
    profiles: [
      { id: 'p1', chain: [{ provider: 'a', model: 'm' }] },
      { id: 'p2', chain: [{ provider: 'a', model: 'm' }] },
    ],
  })
  assert.equal(config.profiles[0].chain.length, 1)
  assert.equal(config.profiles[1].chain.length, 1)
})

test('resolveProfile resolves ids and aliases', () => {
  const config = normalizeConfig({ profiles: [{ id: 'auto', aliases: ['default', 'flash'], chain: [] }] })
  assert.equal(resolveProfile(config, 'auto').id, 'auto')
  assert.equal(resolveProfile(config, 'flash').id, 'auto')
  assert.equal(resolveProfile(config, 'nope'), undefined)
})

test('activeTimeWindow matches numeric windows against the policy offset', () => {
  const policy = { utcOffsetMinutes: 480, timeWindows: [{ id: 'w', label: 'w', from: 0, to: 1439, order: ['b/n'] }] }
  const window = activeTimeWindow(policy, NOW)
  assert.equal(window.id, 'w')
  const entries = [{ id: 'a', provider: 'a', model: 'm' }, { id: 'b', provider: 'b', model: 'n' }]
  assert.deepEqual(applyTimeWindow(entries, window).map((entry) => entry.id), ['b', 'a'])
})

test('unionEfforts merges, sorts and keeps a valid default', () => {
  const union = unionEfforts([
    { efforts: [{ id: 'high' }, { id: 'low', name: 'Low' }] },
    { efforts: [{ id: 'max' }], defaultEffort: 'max' },
    undefined,
  ])
  assert.deepEqual(union.efforts.map((effort) => effort.id), ['low', 'high', 'max'])
  assert.equal(union.efforts[0].name, 'Low')
  assert.equal(union.defaultEffort, 'max')
  assert.equal(unionEfforts([{}, { efforts: undefined }]), undefined)
})

const TARGET = { efforts: [{ id: 'low' }, { id: 'high' }], defaultEffort: 'low' }

test('mapEffort inherits, maps, drops and clamps', () => {
  assert.equal(mapEffort(undefined, TARGET).effort, undefined)
  assert.equal(mapEffort('high', TARGET).effort, 'high')
  assert.equal(mapEffort('max', TARGET).effort, 'low')
  assert.equal(mapEffort('max', TARGET).coerced, true)
  assert.equal(mapEffort('max', TARGET, { max: 'high' }).effort, 'high')
  assert.equal(mapEffort('max', TARGET, { max: null }).effort, undefined)
  assert.equal(mapEffort('max', undefined).effort, 'max')
  assert.equal(mapEffort('max', { efforts: [] }).effort, undefined)
})

test('mapEffort can fail instead of clamping', () => {
  const verdict = mapEffort('max', TARGET, {}, { effortPolicy: 'fail' })
  assert.equal(verdict.error.code, 'UNSUPPORTED_REASONING_EFFORT')
  assert.equal(verdict.effort, undefined)
})

const POLICY = normalizeConfig({}).profiles[0].policy

test('classifyFailure uses trigger codes and statuses', () => {
  assert.equal(classifyFailure({ code: 'QUOTA', status: 429 }, POLICY).retryable, true)
  assert.equal(classifyFailure({ status: 503 }, POLICY).retryable, true)
  assert.equal(classifyFailure({ code: 'MISSING_CREDENTIAL' }, POLICY).retryable, true)
  assert.equal(classifyFailure({ message: 'fetch failed' }, POLICY).code, 'NETWORK_ERROR')
  assert.equal(classifyFailure({ message: 'fetch failed' }, POLICY).retryable, true)
})

test('classifyFailure relabels auth and respects commit', () => {
  const auth = classifyFailure({ status: 401, message: 'bad token' }, POLICY)
  assert.equal(auth.code, 'AUTH')
  assert.equal(auth.authish, true)
  assert.equal(auth.retryable, true)
  assert.equal(classifyFailure({ code: 'QUOTA' }, POLICY, { alreadyCommitted: true }).retryable, false)
})

test('classifyFailure marks request-scoped failures without booking them', () => {
  const verdict = classifyFailure({ code: 'CONTEXT_WINDOW_EXCEEDED' }, POLICY)
  assert.equal(verdict.requestScoped, true)
  assert.equal(verdict.retryable, false)
})

test('retry-after is honored only when enabled', () => {
  assert.equal(classifyFailure({ providerRetryAfterMs: 5000 }, POLICY).retryAfterMs, 5000)
  const off = { ...POLICY, honorRetryAfter: false }
  assert.equal(classifyFailure({ providerRetryAfterMs: 5000 }, off).retryAfterMs, undefined)
})

test('resolveProfileInfo intersects capabilities conservatively', async () => {
  const profile = profileOf({
    profiles: [{ id: 'p', chain: [{ provider: 'a', model: 'm' }, { provider: 'b', model: 'n' }] }],
  })
  const infos = {
    'a/m': {
      inputModalities: ['text', 'image'],
      context: { contextWindow: 100_000 },
      defaultMaxTokens: 8000,
      reasoning: { efforts: [{ id: 'low' }, { id: 'high' }], defaultEffort: 'low' },
      toolUpdate: 'addition-only',
    },
    'b/n': {
      inputModalities: ['text'],
      context: { contextWindow: 200_000 },
      reasoning: { efforts: [{ id: 'max' }] },
      toolUpdate: 'in-history',
    },
  }
  const resolved = await resolveProfileInfo(profile, async (provider, model) => infos[`${provider}/${model}`], profile.policy)
  assert.deepEqual(resolved.inputModalities, ['text'])
  assert.equal(resolved.context.contextWindow, 100_000)
  assert.equal(resolved.defaultMaxTokens, 8000)
  assert.equal(resolved.reasoning.defaultEffort, 'low')
  assert.deepEqual(resolved.reasoning.efforts.map((effort) => effort.id), ['low', 'high', 'max'])
  assert.equal(resolved.toolUpdate, 'addition-only')
  assert.equal(resolved.systemPromptUpdate, 'in-history')

  const info = toModelInfo('autorouter', profile, resolved)
  assert.equal(info.provider, 'autorouter')
  assert.equal(info.id, 'p')
  assert.equal(info.entryCount, undefined)
  assert.equal(info.resolvedCount, undefined)
  assert.equal(info.reasoning.defaultEffort, 'low')
})

test('resolveProfileInfo falls back when the target is unknown', async () => {
  const profile = profileOf({ profiles: [{ id: 'p', chain: [{ provider: 'a', model: 'm' }] }] })
  const resolved = await resolveProfileInfo(profile, async () => undefined, profile.policy)
  assert.deepEqual(resolved.inputModalities, ['text'])
  assert.equal(resolved.context.contextWindow, 128_000)
  assert.equal(resolved.reasoning, undefined)
  assert.equal(resolved.toolUpdate, 'in-history')
})

function selectFixture() {
  const profile = profileOf({
    profiles: [
      {
        id: 'p',
        chain: [
          { id: 'a', provider: 'a', model: 'm' },
          { id: 'b', provider: 'b', model: 'n' },
        ],
      },
    ],
  })
  return profile
}

test('orderCandidates keeps chain order and treats a time window as a reorder', () => {
  const state = new RouterState({ now: () => NOW })
  const plain = selectFixture()
  assert.deepEqual(orderCandidates({ profile: plain, state, now: NOW }).order, ['a/m', 'b/n'])

  const windowed = selectFixture()
  windowed.policy.timeWindows = [{ id: 'w', label: 'w', from: 0, to: 1439, order: ['b/n'] }]
  const ordered = orderCandidates({ profile: windowed, state: new RouterState({ now: () => NOW }), now: NOW })
  assert.deepEqual(ordered.order, ['b/n', 'a/m'])
  assert.deepEqual(ordered.candidates.map((entry) => entry.provider), ['b', 'a'])
})

test('orderCandidates excludes cooling routes', () => {
  const state = new RouterState({ now: () => NOW })
  const profile = selectFixture()

  state.suppress('a/m', 60_000, NOW)
  const cooling = orderCandidates({ profile, state, now: NOW })
  assert.deepEqual(cooling.order, ['b/n'])
  assert.equal(cooling.blocked[0].reason, 'cooldown')
})

test('sticky sessions win over the chain order', () => {
  const state = new RouterState({ now: () => NOW })
  const profile = selectFixture()
  state.pin('session-1', 'p', 'b/n', NOW)
  const selection = orderCandidates({ profile, state, now: NOW, sessionId: 'session-1' })
  assert.equal(selection.sticky, true)
  assert.deepEqual(selection.order, ['b/n', 'a/m'])
})

test('a time window reorders the chain', () => {
  const state = new RouterState({ now: () => NOW })
  const profile = selectFixture()
  profile.policy.mode = 'quality'
  profile.policy.timeWindows = [{ id: 'w', label: 'w', from: 0, to: 1439, utcOffsetMinutes: 480, order: ['b'] }]
  assert.deepEqual(orderCandidates({ profile, state, now: NOW }).order, ['b/n', 'a/m'])
})

test('matchSettingsEntry resolves the plain and the include-prefixed profile row', () => {
  const plain = [{ ns: 'ui-settings-account' }, { ns: 'llm-autorouter', revision: 4 }]
  assert.equal(matchSettingsEntry(plain)?.revision, 4)

  const prefixed = [{ ns: 'include:llm-autorouter', revision: 7 }]
  assert.equal(matchSettingsEntry(prefixed)?.revision, 7)

  const suffixed = [{ ns: 'some-layer:llm-autorouter', revision: 9 }]
  assert.equal(matchSettingsEntry(suffixed)?.revision, 9)

  assert.equal(matchSettingsEntry([{ ns: 'llm-fallbacks' }]), undefined)
  assert.equal(matchSettingsEntry(undefined), undefined)
})