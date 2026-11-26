/**
 * Integration smoke test: boots the plugin's `apply()` against a fake Cordis
 * context and a fake llm/settings/webServer, then drives the HTTP surface.
 *
 * `@deepseek-ai/*` peers are mapped to local stubs by test/stubs/hooks.mjs, so
 * this runs on plain Node without the harness.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { register } from 'node:module'
import test from 'node:test'

register(new URL('./stubs/hooks.mjs', import.meta.url))
const plugin = await import('../index.js')

const ENTRY_ID = 'llm-autorouter'
const PROVIDER_ID = 'autorouter'
const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

function makeHarness() {
  const provided = {}
  const routes = new Map()
  const adapters = []
  const saved = []
  const effects = []
  const listeners = new Map()
  let revision = 3
  let value = { enabled: true }
  let visible = value
  let visibleRevision = revision

  const harness = {
    /** Simulates a host whose settings projection lags behind the write. */
    lag(active) {
      if (!active && visible !== value) {
        visible = value
        visibleRevision = revision
      }
      lagging = active
    },
  }
  let lagging = false

  const settings = {
    describe: () => [{ ns: ENTRY_ID, value: visible, revision: visibleRevision }],
    async replace(ns, next, expected) {
      if (expected !== visibleRevision) throw new Error('revision conflict')
      await Promise.resolve()
      value = next
      revision += 1
      if (!lagging) {
        visible = next
        visibleRevision = revision
      }
      saved.push({ ns, revision, value: next })
    },
  }

  const llm = {
    registerAdapter(providers, adapter) {
      adapters.push({ providers, adapter })
      return () => {}
    },
    listProviders: () => [
      { id: 'opendesign', name: 'OpenDesign' },
      { id: 'commandcode', displayName: 'CommandCode' },
    ],
    async listModels(provider) {
      return provider === 'opendesign'
        ? [{ id: 'deepseek-v4.1-flash-eco', name: 'Flash Eco' }]
        : [{ id: 'deepseek/deepseek-v4.1-flash', name: 'Flash' }]
    },
    async resolveModelInfo(provider, model) {
      return {
        provider,
        id: model,
        name: model,
        inputModalities: ['text', 'image'],
        context: { contextWindow: 1_000_000 },
        reasoning: {
          efforts: [
            { id: 'low', name: 'Low' },
            { id: 'max', name: 'Max' },
          ],
          defaultEffort: 'low',
        },
        toolUpdate: 'addition-only',
      }
    },
    imageRequestPricing: () => undefined,
    stream: () => {
      throw new Error('nested stream must not run in this test')
    },
  }

  const webServer = {
    getOrigin: () => 'http://127.0.0.1:0',
    register(route) {
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  }

  const ctx = {
    logger: () => ({ info() {}, warn() {}, debug() {}, error() {} }),
    provide(name, impl) {
      provided[name] = impl
    },
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') effects.push(dispose)
      return () => {}
    },
    on(event, listener) {
      listeners.set(event, listener)
      return () => {}
    },
    inject(names, callback) {
      const subset = {}
      for (const name of names) {
        const service = { llm, settings, webServer }[name]
        if (service === undefined) return
        subset[name] = service
      }
      callback({ ...ctx, ...subset })
    },
  }

  return { ctx, provided, routes, adapters, saved, effects, listeners, lag: harness.lag, get revision() { return revision } }
}

function fakeRes() {
  return {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(text) {
      this.body = text
    },
  }
}

function fakeReq(method, body) {
  const req = new EventEmitter()
  req.method = method
  setImmediate(() => {
    if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)))
    req.emit('end')
  })
  return req
}

async function call(harness, path, { method = 'GET', body } = {}) {
  const route = harness.routes.get(path)
  assert.ok(route, `route ${path} is registered`)
  const res = fakeRes()
  await route.handler(fakeReq(method, body), res)
  return { status: res.status, body: res.body === '' ? undefined : JSON.parse(res.body) }
}

test('apply registers one provider, one default virtual model and six routes', async () => {
  const harness = makeHarness()
  plugin.apply(harness.ctx, {})

  assert.equal(harness.adapters.length, 1)
  assert.deepEqual(harness.adapters[0].providers, [PROVIDER_ID])
  assert.deepEqual(harness.provided.autorouter.name, PROVIDER_ID)
  assert.equal(harness.provided.autorouter.version, VERSION)

  const adapter = harness.adapters[0].adapter
  assert.deepEqual(adapter.providerInfo(PROVIDER_ID), { id: PROVIDER_ID, name: 'AutoRouter' })

  const models = await adapter.listModels(PROVIDER_ID)
  assert.deepEqual(models.map((model) => model.id), ['auto'])
  assert.equal(models[0].name, 'Auto')
  assert.deepEqual(models[0].inputModalities, ['text', 'image'])

  const resolved = await adapter.resolveModel(PROVIDER_ID, 'auto')
  assert.equal(resolved.context.contextWindow, 1_000_000)
  assert.deepEqual(resolved.reasoning.efforts.map((effort) => effort.id), ['low', 'max'])
  assert.equal(resolved.reasoning.defaultEffort, 'low')
  assert.equal(resolved.toolUpdate, 'addition-only')

  const unknown = await adapter.resolveModel(PROVIDER_ID, 'missing')
  assert.deepEqual(unknown, { provider: PROVIDER_ID, id: 'missing', name: 'missing' })

  assert.deepEqual([...harness.routes.keys()].sort(), [
    '/api/autorouter/catalog',
    '/api/autorouter/config',
    '/api/autorouter/cooldown',
    '/api/autorouter/probe',
    '/api/autorouter/selection',
    '/api/autorouter/state',
  ])
  for (const route of harness.routes.values()) assert.equal(route.auth, 'required')
})

test('state and config handlers are well formed, and a stale revision is refused', async () => {
  const harness = makeHarness()
  plugin.apply(harness.ctx, {})

  const state = await call(harness, '/api/autorouter/state')
  assert.equal(state.status, 200)
  assert.equal(state.body.entryId, ENTRY_ID)
  assert.equal(state.body.providerId, PROVIDER_ID)
  assert.equal(state.body.revision, 3)
  assert.equal(state.body.config.service.token, '')
  assert.equal(state.body.config.service.hasToken, false)
  assert.equal(state.body.status.routes.length, 3)
  assert.match(state.body.status.version, /^\d+\.\d+\.\d+$/, 'the page must be able to tell which host code is running')
  assert.ok(Array.isArray(state.body.status.sessions))

  const stale = await call(harness, '/api/autorouter/config', {
    method: 'PUT',
    body: { value: { enabled: false }, revision: 1 },
  })
  assert.equal(stale.status, 409)
  assert.equal(harness.saved.length, 0)

  const saved = await call(harness, '/api/autorouter/config', {
    method: 'PUT',
    body: { value: { enabled: false }, revision: 3 },
  })
  assert.equal(saved.status, 200)
  assert.equal(saved.body.ok, true)
  assert.equal(saved.body.revision, 4)
  assert.equal(harness.saved.length, 1)
  assert.equal(harness.saved[0].value.enabled, false)
  assert.equal(harness.saved[0].value.profiles.length, 1)
})

test('a save answers with the written config even while the host projection lags', async () => {
  const harness = makeHarness()
  plugin.apply(harness.ctx, {})
  harness.lag(true)

  const saved = await call(harness, '/api/autorouter/config', {
    method: 'PUT',
    body: { value: { enabled: false }, revision: 3 },
  })
  assert.equal(saved.status, 200)
  assert.equal(saved.body.config.enabled, false, 'the response must echo the write, not the stale document')
  assert.equal(harness.saved[0].value.enabled, false)

  const state = await call(harness, '/api/autorouter/state')
  assert.equal(state.status, 200)
  assert.equal(state.body.config.enabled, false, 'the status read must see the write before the loader catches up')

  harness.lag(false)
  const settled = await call(harness, '/api/autorouter/state')
  assert.equal(settled.body.config.enabled, false)
  assert.equal(settled.body.revision, 4)
})

test('catalog, probe and cooldown answer from the live llm runtime', async () => {
  const harness = makeHarness()
  plugin.apply(harness.ctx, {})

  const catalog = await call(harness, '/api/autorouter/catalog')
  assert.equal(catalog.status, 200)
  assert.deepEqual(catalog.body.providers.map((provider) => provider.id), ['opendesign', 'commandcode'])
  assert.deepEqual(catalog.body.providers[1].models.map((model) => model.id), ['deepseek/deepseek-v4.1-flash'])

  const probe = await call(harness, '/api/autorouter/probe', {
    method: 'POST',
    body: { provider: 'opendesign', model: 'deepseek-v4.1-flash-eco' },
  })
  assert.equal(probe.status, 200)
  assert.equal(probe.body.ok, true)
  assert.equal(probe.body.info.context.contextWindow, 1_000_000)

  const missing = await call(harness, '/api/autorouter/probe', {
    method: 'POST',
    body: { provider: 'opendesign', model: 'nope' },
  })
  assert.equal(missing.body.ok, false)
  assert.equal(missing.body.found, false)

  const cooldown = await call(harness, '/api/autorouter/cooldown', { method: 'POST', body: { key: 'x' } })
  assert.deepEqual(cooldown.body, { ok: true })

  const selection = await call(harness, '/api/autorouter/selection')
  assert.equal(selection.status, 200)
  assert.equal(selection.body.entryId, ENTRY_ID)
  assert.ok(Array.isArray(selection.body.profiles.auto.candidates))
  assert.ok(selection.body.profiles.auto.candidates.length > 0)
})
