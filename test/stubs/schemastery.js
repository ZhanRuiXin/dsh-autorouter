function node(extra = {}) {
  return {
    ...extra,
    default(value) {
      return { ...extra, default: value }
    },
  }
}

const z = {
  object: (shape) => node({ shape }),
  array: (items) => node({ items }),
  any: () => node(),
  number: () => node(),
  boolean: () => node(),
  string: () => node(),
}

export default z
