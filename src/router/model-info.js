/**
 * Virtual model metadata: the union/intersection of what the chain can do.
 * A conservative virtual model is what makes host-side compaction and the
 * model picker behave when the actual upstream changes between calls.
 */

import { enabledEntries } from '../config.js'
import { unionEfforts } from './effort.js'

export function profileDisplayName(profile) {
  return profile.name === '' ? profile.id : profile.name
}

function intersectModalities(infos) {
  const known = infos
    .map((info) => info?.inputModalities)
    .filter((modalities) => Array.isArray(modalities) && modalities.length > 0)
  if (known.length === 0) return ['text']
  let result = [...new Set(known[0])]
  for (const modalities of known.slice(1)) {
    const set = new Set(modalities)
    result = result.filter((modality) => set.has(modality))
  }
  return result.length === 0 ? ['text'] : result
}

/**
 * @param {object} profile
 * @param {(provider: string, model: string) => Promise<object | undefined>} infoOf
 * @param {{contextPolicy?: 'min' | 'fixed', defaultContextWindow?: number}} policy
 */
export async function resolveProfileInfo(profile, infoOf, policy = {}) {
  const entries = enabledEntries(profile)
  const infos = await Promise.all(
    entries.map(async (entry) => {
      try {
        return await infoOf(entry.provider, entry.model)
      } catch {
        return undefined
      }
    }),
  )
  const known = infos.filter((info) => info !== undefined && info !== null)

  const windows = known
    .map((info) => info.context?.contextWindow)
    .filter((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)
  const fallbackWindow = policy.defaultContextWindow ?? 128000
  const contextWindow =
    policy.contextPolicy === 'fixed'
      ? fallbackWindow
      : windows.length > 0
        ? Math.min(...windows)
        : fallbackWindow

  const maxTokens = known
    .map((info) => info.defaultMaxTokens)
    .filter((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)

  const reasoning = unionEfforts(
    known.map((info) => ({ efforts: info.reasoning?.efforts, defaultEffort: info.reasoning?.defaultEffort })),
  )

  const toolUpdate = known.some((info) => info.toolUpdate === 'addition-only') ? 'addition-only' : 'in-history'

  return {
    inputModalities: intersectModalities(known),
    context: { contextWindow },
    ...(maxTokens.length > 0 ? { defaultMaxTokens: Math.min(...maxTokens) } : {}),
    ...(reasoning === undefined ? {} : { reasoning }),
    systemPromptUpdate: 'in-history',
    toolUpdate,
    // Diagnostics, not part of LlmResolvedModelInfo; stripped before returning.
    entryCount: entries.length,
    resolvedCount: known.length,
  }
}

/** Shape a resolved profile for the llm service (no diagnostic fields). */
export function toModelInfo(provider, profile, resolved) {
  return {
    provider,
    id: profile.id,
    name: profileDisplayName(profile),
    ...(profile.description === '' ? {} : { description: profile.description }),
    inputModalities: resolved.inputModalities,
    context: resolved.context,
    ...(resolved.defaultMaxTokens === undefined ? {} : { defaultMaxTokens: resolved.defaultMaxTokens }),
    ...(resolved.reasoning === undefined
      ? {}
      : {
          reasoning: {
            efforts: resolved.reasoning.efforts,
            ...(resolved.reasoning.defaultEffort === undefined ? {} : { defaultEffort: resolved.reasoning.defaultEffort }),
          },
        }),
    systemPromptUpdate: resolved.systemPromptUpdate,
    toolUpdate: resolved.toolUpdate,
  }
}
