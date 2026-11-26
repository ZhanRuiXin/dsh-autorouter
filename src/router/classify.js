/**
 * Failure classification. Pure: no DSH imports, no clock, no I/O.
 */

export const ROUTE_DEAD_CODES = new Set([
  'UNKNOWN_MODEL',
  'MISSING_CREDENTIAL',
  'INVALID_CREDENTIAL',
  'NO_CREDENTIAL_STORE',
  'ACCOUNT_SIGN_IN_REQUIRED',
  'ACCOUNT_TOKEN_INVALID',
])

/** Failures that say "this request cannot work", not "this route is unhealthy". */
export const REQUEST_SCOPED_CODES = new Set([
  'CONTEXT_WINDOW_EXCEEDED',
  'MODEL_UNSUPPORTED',
  'UNSUPPORTED_OPTION',
  'UNSUPPORTED_CONTENT',
  'UNSUPPORTED_REASONING_EFFORT',
  'INVALID_REQUEST',
])

const NETWORK_PATTERN =
  /fetch failed|ECONN(?:REFUSED|RESET|ABORTED)|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network|timed? ?out/i

const OAUTH_SUBJECT = /oauth[\s_-]*(?:refresh|token|grant)|token[\s_-]?refresh|refresh[\s_-]?token|authorization\s+grant/i
const OAUTH_TRANSIENT = /\btimeout\b|\bnetwork\b|fetch failed|ECONN(?:REFUSED|RESET|ABORTED)|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|\b(?:408|425|429|5\d{2})\b|rate[ _-]?limit|too many requests|temporar(?:y|ily)|unavailable/i

export function failureOf(error) {
  if (error === undefined || error === null) return { message: 'unknown failure', code: undefined }
  if (typeof error === 'object' && typeof error.failure === 'object' && error.failure !== null) return error.failure
  return {
    message: typeof error.message === 'string' ? error.message : String(error),
    code: typeof error.code === 'string' ? error.code : undefined,
    status: typeof error.status === 'number' ? error.status : undefined,
    providerRetryAfterMs:
      typeof error.providerRetryAfterMs === 'number' ? error.providerRetryAfterMs : undefined,
    requestId: typeof error.requestId === 'string' ? error.requestId : undefined,
  }
}

/**
 * Decide whether a failure may advance the chain.
 *
 * @returns {{retryable: boolean, code: string, status?: number, reason: string,
 *            requestScoped: boolean, retryAfterMs?: number, authish: boolean}}
 */
export function classifyFailure(failure, policy, { alreadyCommitted = false } = {}) {
  const message = typeof failure?.message === 'string' ? failure.message : ''
  const rawCode = typeof failure?.code === 'string' ? failure.code : ''
  const status = typeof failure?.status === 'number' ? failure.status : undefined
  const authish =
    rawCode === 'AUTH' ||
    rawCode === 'UNAUTHORIZED' ||
    status === 401 ||
    status === 403 ||
    (OAUTH_SUBJECT.test(message) && !OAUTH_TRANSIENT.test(message))
  let code = rawCode === '' ? (authish ? 'AUTH' : 'UNKNOWN_ERROR') : rawCode
  if (authish && code !== 'AUTH') code = 'AUTH'

  const requestScoped = REQUEST_SCOPED_CODES.has(code)
  const triggerCodes = policy.triggerCodes ?? []
  const triggerStatuses = policy.triggerStatuses ?? []

  let retryable = ROUTE_DEAD_CODES.has(code) || triggerCodes.includes(code)
  if (!retryable && status !== undefined && triggerStatuses.includes(status)) retryable = true
  if (!retryable && policy.retryOnNetwork !== false && NETWORK_PATTERN.test(message)) {
    retryable = true
    code = 'NETWORK_ERROR'
  }
  if (alreadyCommitted) retryable = false

  const retryAfterMs =
    policy.honorRetryAfter !== false && typeof failure?.providerRetryAfterMs === 'number'
      ? Math.max(0, failure.providerRetryAfterMs)
      : undefined

  return {
    retryable,
    code,
    status,
    reason: message === '' ? code : message,
    requestScoped,
    retryAfterMs,
    authish,
  }
}

export function describeFailure(failure) {
  const code = typeof failure?.code === 'string' ? failure.code : 'ERROR'
  const message = typeof failure?.message === 'string' ? failure.message : ''
  return `${code}${message === '' ? '' : `: ${message}`}`
}
