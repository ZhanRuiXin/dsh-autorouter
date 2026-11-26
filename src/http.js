/**
 * Same-origin JSON surface for the Settings page. It runs on the harness's own
 * port (`webServer.register`), is authenticated by the harness, and is the only
 * place that calls `settings.replace` — so every save stays revision-checked.
 *
 * It never returns credentials, prompts or message bodies.
 */

import { ENTRY_ID, PROVIDER_ID, matchSettingsEntry, normalizeConfig } from './config.js'

const MAX_BODY = 2 * 1024 * 1024

function json(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('body too large'), { statusCode: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(Object.assign(new Error(`invalid JSON: ${error.message}`), { statusCode: 400 }))
      }
    })
    req.on('error', reject)
  })
}

function redact(config) {
  const { token, ...service } = config.service
  return { ...config, service: { ...service, token: '', hasToken: typeof token === 'string' && token !== '' } }
}

export function installRoutes(deps) {
  const { webServer, getConfig, getSettings, getLlm, getState, getSelection, onConfigSaved, logger } = deps
  let catalogCache

  async function providerDirectory(llm) {
    // The directory method has been named differently across harness builds;
    // probe the known shapes instead of pinning one and silently listing
    // nothing on another.
    for (const method of ['listProviders', 'listProviderDirectory', 'listConfigurableProviders']) {
      if (typeof llm[method] !== 'function') continue
      try {
        const listed = await Promise.resolve(llm[method]())
        if (Array.isArray(listed)) return listed
      } catch (error) {
        logger?.debug?.(`llm-autorouter: ${method} failed: ${error.message}`)
      }
    }
    return []
  }

  async function buildCatalog(force = false) {
    const now = Date.now()
    if (!force && catalogCache !== undefined && now - catalogCache.at < 30_000) return catalogCache.value
    const llm = getLlm()
    if (llm === undefined) return { at: now, providers: [] }
    const listed = await providerDirectory(llm)
    const providers = await Promise.all(
      listed.map(async (provider) => {
        const id = typeof provider?.id === 'string' ? provider.id : provider?.provider
        if (typeof id !== 'string' || id === '' || id === PROVIDER_ID) return undefined
        let models = []
        try {
          models = await Promise.resolve(llm.listModels(id))
        } catch {
          models = []
        }
        return {
          id,
          name: typeof provider.name === 'string' ? provider.name : typeof provider.displayName === 'string' ? provider.displayName : id,
          models: (Array.isArray(models) ? models : [])
            .map((model) => ({
              id: model.id,
              name: typeof model.name === 'string' ? model.name : model.id,
              ...(Array.isArray(model.inputModalities) ? { inputModalities: model.inputModalities } : {}),
            }))
            .sort((left, right) => left.id.localeCompare(right.id)),
        }
      }),
    )
    const value = { at: now, providers: providers.filter((provider) => provider !== undefined) }
    catalogCache = { at: now, value }
    return value
  }

  const routes = [
    {
      kind: 'exact',
      path: '/api/autorouter/state',
      auth: 'required',
      handler: async (req, res) => {
        if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
        const settings = getSettings()
        let descriptor
        try {
          descriptor = matchSettingsEntry(settings?.describe?.())
        } catch (error) {
          logger?.warn?.(`llm-autorouter: settings.describe failed: ${error.message}`)
        }
        const config = getConfig()
        const state = getState()
        json(res, 200, {
          entryId: ENTRY_ID,
          providerId: PROVIDER_ID,
          revision: descriptor?.revision,
          config: redact(config),
          status: state.snapshot(config, Date.now()),
        })
      },
    },
    {
      kind: 'exact',
      path: '/api/autorouter/config',
      auth: 'required',
      handler: async (req, res) => {
        if (req.method === 'GET') {
          const settings = getSettings()
          let descriptor
          try {
            descriptor = matchSettingsEntry(settings?.describe?.())
          } catch {
            descriptor = undefined
          }
          return json(res, 200, {
            revision: descriptor?.revision,
            config: redact(getConfig()),
          })
        }
        if (req.method !== 'PUT') return json(res, 405, { error: 'method not allowed' })
        const settings = getSettings()
        if (settings === undefined) return json(res, 503, { error: 'settings service unavailable' })
        let body
        try {
          body = await readJson(req)
        } catch (error) {
          return json(res, error.statusCode ?? 400, { error: error.message })
        }
        if (typeof body !== 'object' || body === null || typeof body.value !== 'object') {
          return json(res, 400, { error: 'expected { value, revision }' })
        }
        const current = getConfig()
        const next = normalizeConfig(body.value, { fallback: current })
        if (next.service.token === '' && current.service.token !== '') next.service.token = current.service.token
        let descriptor
        try {
          descriptor = matchSettingsEntry(settings.describe())
        } catch (error) {
          return json(res, 503, { error: `settings unavailable: ${error.message}` })
        }
        if (descriptor === undefined) {
          return json(res, 404, { error: `no profile entry "${ENTRY_ID}" — install or enable the bundle first` })
        }
        const expected = Number(body.revision)
        if (Number.isFinite(expected) && descriptor.revision !== expected) {
          return json(res, 409, {
            error: 'revision conflict: the config was saved somewhere else',
            revision: descriptor.revision,
            config: redact(normalizeConfig(descriptor.value ?? current, { fallback: current })),
          })
        }
        try {
          await settings.replace(descriptor.ns, next, descriptor.revision)
        } catch (error) {
          return json(res, 409, { error: `save failed: ${error.message}`, revision: descriptor.revision })
        }
        onConfigSaved?.()
        let fresh
        try {
          fresh = matchSettingsEntry(settings.describe())
        } catch {
          fresh = undefined
        }
        json(res, 200, { ok: true, revision: fresh?.revision, config: redact(normalizeConfig(fresh?.value ?? next)) })
      },
    },
    {
      kind: 'exact',
      path: '/api/autorouter/catalog',
      auth: 'required',
      handler: async (req, res) => {
        if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
        const catalog = await buildCatalog(true)
        json(res, 200, catalog)
      },
    },
    {
      kind: 'exact',
      path: '/api/autorouter/probe',
      auth: 'required',
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
        let body
        try {
          body = await readJson(req)
        } catch (error) {
          return json(res, error.statusCode ?? 400, { error: error.message })
        }
        const provider = typeof body.provider === 'string' ? body.provider : ''
        const model = typeof body.model === 'string' ? body.model : ''
        const llm = getLlm()
        if (provider === '' || model === '' || llm === undefined) {
          return json(res, 400, { ok: false, error: 'provider and model are required' })
        }
        const startedAt = Date.now()
        try {
          const models = await Promise.resolve(llm.listModels(provider))
          const found = Array.isArray(models) && models.some((item) => item.id === model)
          if (!found) {
            return json(res, 200, { ok: false, found: false, error: 'model not in this provider catalog' })
          }
          const info = await Promise.resolve(llm.resolveModelInfo(provider, model))
          json(res, 200, {
            ok: true,
            found: true,
            ms: Date.now() - startedAt,
            info: {
              name: info?.name,
              context: info?.context,
              reasoning: info?.reasoning,
              toolUpdate: info?.toolUpdate,
            },
          })
        } catch (error) {
          json(res, 200, { ok: false, found: false, error: error.message, ms: Date.now() - startedAt })
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/autorouter/cooldown',
      auth: 'required',
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
        let body
        try {
          body = await readJson(req)
        } catch (error) {
          return json(res, error.statusCode ?? 400, { error: error.message })
        }
        const state = getState()
        if (typeof body.key === 'string' && body.key !== '') state.clearCooldown(body.key)
        else state.cooldowns.clear()
        json(res, 200, { ok: true })
      },
    },
    {
      kind: 'exact',
      path: '/api/autorouter/selection',
      auth: 'required',
      handler: async (req, res) => {
        if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
        json(res, 200, getSelection())
      },
    },
  ]

  const disposers = []
  for (const route of routes) {
    try {
      disposers.push(webServer.register(route))
    } catch (error) {
      if (String(error?.message ?? '').includes('already')) {
        logger?.debug?.(`llm-autorouter: route ${route.path} already registered`)
        continue
      }
      throw error
    }
  }
  return () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        /* disposed with the fiber */
      }
    }
  }
}
