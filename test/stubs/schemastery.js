function node(extra = {}) {
  return {
    ...extra,
    default(value) {
      return node({ ...extra, default: value })
    },
    extra(key, value) {
      return node({ ...extra, [key]: value })
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
