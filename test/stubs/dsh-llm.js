/**
 * Test-only stand-in for `@deepseek-ai/dsh-llm`. Only the shapes the plugin
 * touches are implemented; the real package is resolved by the DSH loader.
 */

export class LlmError extends Error {
  constructor(message, code) {
    super(message)
    this.code = code
  }

  static fromFailure({ message, code }) {
    return new LlmError(message, code)
  }
}

export class LlmAdapter {
  providerInfo(provider) {
    return { id: provider, name: provider }
  }

  providerRetryPolicy() {
    return undefined
  }

  imageRequestPricing() {
    return undefined
  }

  imageRequestTarget() {
    return undefined
  }

  async listModels() {
    return []
  }

  async resolveModel(provider, model) {
    return { provider, id: model, name: model }
  }

  prepareCall() {
    throw new Error('stub: prepareCall is not used by the router tests')
  }

  stream() {
    throw new Error('stub: stream is not used by the router tests')
  }
}
