/**
 * The virtual provider. Everything dialect-specific stays inside the upstream
 * adapters DSH already registered: this class only picks a route and forwards
 * the call, which is why attachments, typed tool history and replay state keep
 * working without an HTTP translation layer.
 */

import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'

import {
  PROVIDER_NAME,
  enabledEntries,
  resolveProfile,
} from './config.js'
import { resolveProfileInfo, toModelInfo } from './router/model-info.js'
import { walkRoute } from './router/walk.js'

const INFO_TTL_MS = 60_000

export function routeError(message, code) {
  return LlmError.fromFailure({ message, code })
}

export class AutoRouterAdapter extends LlmAdapter {
  constructor(deps) {
    super()
    this.deps = deps
    this.infoCache = new Map()
  }

  providerInfo(provider) {
    return { id: provider, name: PROVIDER_NAME }
  }

  providerRetryPolicy() {
    return undefined
  }

  async infoOf(provider, model, signal) {
    const llm = this.deps.getLlm()
    if (llm === undefined) return undefined
    try {
      return await llm.resolveModelInfo(provider, model, signal)
    } catch {
      return undefined
    }
  }

  async resolveProfileModel(profile, signal) {
    const cacheKey = profile.id
    const cached = this.infoCache.get(cacheKey)
    const now = Date.now()
    if (cached !== undefined && now - cached.at < INFO_TTL_MS) return cached.value
    const resolved = await resolveProfileInfo(
      profile,
      (provider, model) => this.infoOf(provider, model, signal),
      profile.policy,
    )
    const value = toModelInfo(this.deps.providerId ?? 'autorouter', profile, resolved)
    this.infoCache.set(cacheKey, { at: now, value })
    return value
  }

  async listModels(provider) {
    const config = this.deps.getConfig()
    const profiles = config.profiles.filter((profile) => profile.enabled)
    return Promise.all(
      profiles.map(async (profile) => {
        const info = await this.resolveProfileModel(profile)
        return {
          provider,
          id: profile.id,
          name: info.name,
          ...(info.description === undefined ? {} : { description: info.description }),
          inputModalities: info.inputModalities,
        }
      }),
    )
  }

  async resolveModel(provider, model, signal) {
    const config = this.deps.getConfig()
    const profile = resolveProfile(config, model)
    if (profile === undefined) return { provider, id: model, name: model }
    try {
      return await this.resolveProfileModel(profile, signal)
    } catch {
      return { provider, id: model, name: profile.name }
    }
  }

  imageRequestPricing(provider, model) {
    try {
      const config = this.deps.getConfig()
      const profile = resolveProfile(config, model)
      const entry = profile === undefined ? undefined : enabledEntries(profile)[0]
      const llm = this.deps.getLlm()
      if (entry === undefined || llm === undefined) return undefined
      return llm.imageRequestPricing(entry.provider, entry.model)
    } catch {
      return undefined
    }
  }

  stream(options) {
    const config = this.deps.getConfig()
    if (config.enabled !== true) {
      throw routeError('AutoRouter is disabled in Settings → AutoRouter.', 'AUTOROUTER_DISABLED')
    }
    const profile = resolveProfile(config, options.model)
    if (profile === undefined) {
      throw routeError(
        `AutoRouter: unknown virtual model "${String(options.model)}" — pick one of ${config.profiles
          .map((item) => item.id)
          .join(', ')}.`,
        'UNKNOWN_MODEL',
      )
    }
    if (profile.enabled !== true) {
      throw routeError(`AutoRouter: virtual model "${profile.id}" is disabled.`, 'PROFILE_DISABLED')
    }
    if (enabledEntries(profile).length === 0) {
      throw routeError(`AutoRouter: the chain of "${profile.id}" is empty.`, 'EMPTY_CHAIN')
    }
    const llm = this.deps.getLlm()
    if (llm === undefined) {
      throw routeError('AutoRouter: the llm runtime is unavailable.', 'LLM_UNAVAILABLE')
    }
    return walkRoute({
      options: { ...options, provider: this.deps.providerId ?? 'autorouter' },
      profile,
      config,
      state: this.deps.getState(),
      streamFn: (attempt) => llm.stream(attempt),
      infoOf: (provider, model, signal) => this.infoOf(provider, model, signal),
      makeError: routeError,
      log: this.deps.log ?? {},
    })
  }
}
