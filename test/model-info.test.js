/**
 * The host validates whatever an adapter returns from `resolveModel` and throws
 * when it disagrees (`normalizeModelInfo` in `@deepseek-ai/dsh-llm`). A throw
 * there costs the whole model row, so the virtual metadata is checked here
 * against the same rules instead of being discovered after a restart.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeConfig } from '../src/config.js'
import { resolveProfileInfo, toModelInfo } from '../src/router/model-info.js'

/** Mirror of the host's `LlmRuntime#normalizeModelInfo` checks. */
function assertHostAccepts(provider, model, resolved) {
  const fail = (what) => assert.fail(`host rejects ${what}: ${JSON.stringify(resolved)}`)
  if (typeof resolved.provider !== 'string' || resolved.provider !== provider) fail('provider')
  if (typeof resolved.id !== 'string' || resolved.id !== model) fail('id')
  if (typeof resolved.name !== 'string' || resolved.name.length === 0) fail('name')
  if (resolved.description !== undefined && typeof resolved.description !== 'string') fail('description')
  const context = resolved.context
  if (context !== undefined && (!Number.isInteger(context.contextWindow) || context.contextWindow <= 0)) {
    fail('context')
  }
  if (resolved.defaultMaxTokens !== undefined) {
    if (!Number.isSafeInteger(resolved.defaultMaxTokens) || resolved.defaultMaxTokens <= 0) fail('defaultMaxTokens')
  }
  if (resolved.systemPromptUpdate !== undefined && resolved.systemPromptUpdate !== 'in-history') fail('systemPromptUpdate')
  if (resolved.toolUpdate !== undefined && resolved.toolUpdate !== 'in-history' && resolved.toolUpdate !== 'addition-only') {
    fail('toolUpdate')
  }
  const reasoning = resolved.reasoning
  if (reasoning === undefined) return resolved
  if (reasoning.efforts.length === 0) fail('empty reasoning.efforts')
  const seen = new Set()
  for (const effort of reasoning.efforts) {
    if (typeof effort.id !== 'string' || effort.id.length === 0) fail('effort.id')
    if (typeof effort.name !== 'string' || effort.name.length === 0) fail('effort.name')
    if (seen.has(effort.id)) fail('duplicate effort.id')
    seen.add(effort.id)
  }
  if (reasoning.defaultEffort !== undefined && !seen.has(reasoning.defaultEffort)) fail('unknown defaultEffort')
  return resolved
}

function profileOf(raw) {
  return normalizeConfig(raw).profiles[0]
}

function chainOf(entries) {
  return profileOf({ profiles: [{ id: 'auto', name: 'Auto', chain: entries }] })
}

async function infoOfMap(map) {
  return resolveProfileInfo(
    chainOf(Object.keys(map).map((key) => {
      const [provider, ...rest] = key.split('/')
      return { provider, model: rest.join('/') }
    })),
    async (provider, model) => map[`${provider}/${model}`],
    {},
  )
}

test('virtual model metadata passes the host validator', async () => {
  const profile = chainOf([
    { provider: 'opendesign', model: 'deepseek-v4.1-flash-eco' },
    { provider: 'deepseek-account', model: 'deepseek-flash' },
  ])
  const resolved = await resolveProfileInfo(
    profile,
    async (provider) => ({
      provider,
      id: 'x',
      name: 'X',
      context: { contextWindow: provider === 'opendesign' ? 200000 : 1000000 },
      defaultMaxTokens: 8192,
      reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' },
      toolUpdate: 'addition-only',
    }),
    profile.policy,
  )
  assertHostAccepts('autorouter', 'auto', toModelInfo('autorouter', profile, resolved))
  assert.equal(resolved.context.contextWindow, 200000)
  assert.equal(resolved.defaultMaxTokens, 8192)
  assert.equal(resolved.toolUpdate, 'addition-only')
})

test('an upstream that declares no efforts yields no reasoning block at all', async () => {
  const empty = await infoOfMap({
    'a/m': { context: { contextWindow: 128000 }, reasoning: { efforts: [] } },
    'b/n': { context: { contextWindow: 64000 }, reasoning: { efforts: [], defaultEffort: 'high' } },
  })
  assert.equal(empty.reasoning, undefined)
  const profile = chainOf([{ provider: 'a', model: 'm' }])
  assertHostAccepts('autorouter', 'auto', toModelInfo('autorouter', profile, empty))

  const dropped = await infoOfMap({ 'a/m': { efforts: [] }, 'b/n': { reasoning: { efforts: [{ id: 'low' }] } } })
  // One real declaration is enough; the stray empty list is ignored, and the
  // effort kept a name because the host demands one.
  assert.deepEqual(dropped.reasoning.efforts, [{ id: 'low', name: 'low' }])
  assert.equal(dropped.reasoning.defaultEffort, undefined)
})

test('a nonsense context window never reaches the host as nonsense', async () => {
  const resolved = await infoOfMap({
    'a/m': { context: { contextWindow: 0 } },
    'b/n': { context: { contextWindow: -5 } },
  })
  assert.equal(resolved.context.contextWindow, 128000)

  const fractional = await resolveProfileInfo(
    chainOf([{ provider: 'a', model: 'm' }]),
    async () => ({ context: { contextWindow: 0.5 }, defaultMaxTokens: 12.7 }),
    { contextPolicy: 'fixed', defaultContextWindow: 64000.4 },
  )
  assert.equal(fractional.context.contextWindow, 64000)
  assert.equal(fractional.defaultMaxTokens, 12)
})

test('a profile without a name still produces a usable model row', async () => {
  const bare = profileOf({ profiles: [{ id: 'plain', name: '   ', chain: [{ provider: 'a', model: 'm' }] }] })
  const resolved = await resolveProfileInfo(bare, async () => undefined, bare.policy)
  const info = toModelInfo('autorouter', bare, resolved)
  assert.equal(info.name, 'plain')
  assertHostAccepts('autorouter', 'plain', info)
})

test('efforts from several upstreams merge without duplicates', async () => {
  const merged = await infoOfMap({
    'a/m': { reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'high' } },
    'b/n': { reasoning: { efforts: [{ id: 'high', name: 'HIGH' }, { id: 'max', name: 'Max' }], defaultEffort: 'max' } },
  })
  assert.deepEqual(
    merged.reasoning.efforts.map((effort) => effort.id),
    ['low', 'high', 'max'],
  )
  assert.equal(merged.reasoning.defaultEffort, 'max')
  const profile = chainOf([{ provider: 'a', model: 'm' }])
  assertHostAccepts('autorouter', 'auto', toModelInfo('autorouter', profile, merged))
})
