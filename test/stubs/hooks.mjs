const targets = new Map([
  ['@deepseek-ai/dsh-llm', new URL('./dsh-llm.js', import.meta.url).href],
  ['@deepseek-ai/schemastery', new URL('./schemastery.js', import.meta.url).href],
])

export async function resolve(specifier, context, nextResolve) {
  const target = targets.get(specifier)
  if (target !== undefined) return { url: target, shortCircuit: true }
  return nextResolve(specifier, context)
}
