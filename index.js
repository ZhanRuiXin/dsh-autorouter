/**
 * AutoRouter — one DSH provider (`autorouter` / "AutoRouter") that walks a
 * quota-aware fallback chain over the providers and models already registered
 * in DeepSeek Harness.
 *
 * The plugin registers a native `LlmAdapter`. It does not proxy HTTP: each
 * attempt is a nested `ctx.llm.stream()` call to a real route, so upstream
 * credentials, dialects, attachments and replay state stay inside DSH.
 */

import { createRequire } from 'node:module'

import z from '@deepseek-ai/schemastery'

import { AutoRouterAdapter } from './src/adapter.js'
import {
  DEFAULT_CONFIG,
  ENTRY_ID,
  PROVIDER_ID,
  matchSettingsEntry,
  normalizeConfig,
  resolveProfile,
} from './src/config.js'
import { installRoutes } from './src/http.js'
import { describeOrder, orderCandidates } from './src/router/select.js'
import { RouterState } from './src/state.js'

const require = createRequire(import.meta.url)
const { version: VERSION } = require('./package.json')

export const name = 'llm-autorouter'
export const inject = ['llm']

/**
 * The schema is intentionally shallow: the settings page is custom, and the
 * shapes below are validated by `normalizeConfig` (which also bounds every
 * number). A deep schemastery tree would duplicate that logic and could reject
 * a config the page can still repair.
 */
export const Config = z.object({
  version: z.number().default(1),
  enabled: z.boolean().default(true),
  debug: z.boolean().default(false),
  profiles: z.array(z.any()).default([]),
  gateway: z.any(),
  service: z.any(),
}).extra('volatile', true)

const isLiveRef = (value) => typeof value === 'object' && value !== null && typeof value.get === 'function'

export function apply(ctx, config = DEFAULT_CONFIG) {
  const logger = ctx.logger('llm-autorouter')
  const fallback = normalizeConfig(isLiveRef(config) ? config.get() : config, { fallback: DEFAULT_CONFIG })
  const state = new RouterState()
  let llm
  let settings
  let handle
  let registered = false
  let cache

  const getLlm = () => llm
  const getState = () => state

  function getConfig() {
    if (settings !== undefined && typeof settings.describe === 'function') {
      try {
        const descriptor = matchSettingsEntry(settings.describe())
        if (descriptor !== undefined) {
          if (cache !== undefined && cache.revision === descriptor.revision && Date.now() - cache.at < 5000) {
            return cache.value
          }
          const value = normalizeConfig(descriptor.value, { fallback })
          cache = { revision: descriptor.revision, value, at: Date.now() }
          return value
        }
      } catch (error) {
        logger.debug(`llm-autorouter: settings.describe failed, using the boot config: ${error.message}`)
      }
    }
    return fallback
  }

  const adapter = new AutoRouterAdapter({
    providerId: PROVIDER_ID,
    getConfig,
    getLlm,
    getState,
    log: {
      info: (...args) => logger.info(...args),
      warn: (...args) => logger.warn(...args),
      debug: (...args) => logger.debug(...args),
    },
  })

  function invalidate() {
    cache = undefined
    adapter.infoCache.clear()
  }

  function reconcile() {
    if (llm === undefined) return
    const enabled = getConfig().enabled !== false
    if (enabled && !registered) {
      try {
        handle = llm.registerAdapter([PROVIDER_ID], adapter)
        registered = true
        logger.info(`llm-autorouter: provider "${PROVIDER_ID}" registered (${PROVIDER_ID}/<profile>)`)
      } catch (error) {
        if (error?.code === 'DUPLICATE_ADAPTER') {
          logger.debug('llm-autorouter: adapter already registered on this fiber — multi-fiber dedupe')
        } else {
          throw error
        }
      }
    } else if (!enabled && registered) {
      try {
        handle?.()
      } catch {
        /* disposed with the fiber */
      }
      handle = undefined
      registered = false
      logger.info(`llm-autorouter: provider "${PROVIDER_ID}" unregistered (disabled in settings)`)
    }
  }

  function getSelection() {
    const current = getConfig()
    const now = Date.now()
    const profiles = {}
    for (const profile of current.profiles) {
      profiles[profile.id] = describeOrder(orderCandidates({ profile, state, now }))
    }
    return { at: now, entryId: ENTRY_ID, profiles }
  }

  try {
    ctx.provide('autorouter', {
      name: PROVIDER_ID,
      version: VERSION,
      getConfig,
      getState,
      getSelection,
      snapshot: () => state.snapshot(getConfig(), Date.now(), getConfig().profiles[0]?.policy.utcOffsetMinutes ?? 480),
      resolveProfile: (model) => resolveProfile(getConfig(), model),
    })
  } catch (error) {
    logger.debug(`llm-autorouter: service already provided on this fiber: ${error.message}`)
  }

  ctx.effect(() => {
    const timer = setInterval(() => state.prune(), 5 * 60 * 1000)
    timer.unref?.()
    return () => clearInterval(timer)
  }, 'llm-autorouter: state prune')

  ctx.inject(['llm'], (serviceContext) => {
    llm = serviceContext.llm
    reconcile()
    return () => {
      try {
        handle?.()
      } catch {
        /* already disposed */
      }
      handle = undefined
      registered = false
      llm = undefined
    }
  })

  ctx.inject(['settings'], (serviceContext) => {
    settings = serviceContext.settings
    invalidate()
    reconcile()
    const dispose = ctx.on('settings/document-updated', (ns) => {
      if (ns !== ENTRY_ID && !String(ns).endsWith(`:${ENTRY_ID}`)) return
      invalidate()
      reconcile()
    })
    return () => {
      try {
        dispose()
      } catch {
        /* already disposed */
      }
      settings = undefined
      cache = undefined
    }
  })

  ctx.inject(['webServer'], (serviceContext) =>
    installRoutes({
      webServer: serviceContext.webServer,
      getConfig,
      getSettings: () => settings,
      getLlm,
      getState,
      getSelection,
      onConfigSaved: invalidate,
      logger,
    }),
  )

  logger.debug(`llm-autorouter ${VERSION}: entry "${ENTRY_ID}", provider "${PROVIDER_ID}"`)
}
