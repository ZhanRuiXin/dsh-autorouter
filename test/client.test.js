/**
 * Loads the browser half on plain Node with a fake ModuleLoader and asserts the
 * Settings registration shape. It cannot render JSX/React, but it does catch
 * module-scope errors and a wrong slot/order/locale.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

let loaded

globalThis.window = {
  __ModuleLoader__: {
    load(spec) {
      loaded = spec
    },
  },
}

globalThis.document = {
  createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
  head: { appendChild() {} },
}

await import('../client.js')

const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  Fragment: 'fragment',
  useState: () => {
    throw new Error('hooks must not run outside a component')
  },
  useEffect: () => {
    throw new Error('hooks must not run outside a component')
  },
  useRef: () => {
    throw new Error('hooks must not run outside a component')
  },
}

test('client registers the AutoRouter settings section', () => {
  assert.equal(loaded.id, 'dsh-autorouter')

  const client = loaded.factory((name) => {
    assert.equal(name, 'react')
    return React
  })

  assert.deepEqual(client.inject, ['slots', 'locale'])

  const effects = []
  const registered = []
  const ctx = {
    effect(fn, label) {
      effects.push(label)
      fn()
      return () => {}
    },
    locale: {
      register(ns, dictionaries) {
        assert.equal(ns, 'settings.autorouter')
        assert.equal(typeof dictionaries.zh.nav, 'string')
        assert.equal(typeof dictionaries.en.nav, 'string')
        return () => {}
      },
      bind(ns) {
        return (key) => `${ns}.${key}`
      },
    },
    slots: {
      inject(name, callback) {
        registered.push({ name })
        callback()
        return () => {}
      },
      register(descriptor, component) {
        const slot = registered[registered.length - 1]
        slot.descriptor = descriptor
        slot.component = component
        return () => {}
      },
    },
  }

  client.apply(ctx)

  assert.deepEqual(effects, ['autorouter: styles', 'autorouter: locale'])
  assert.deepEqual(
    registered.map((slot) => slot.name),
    ['settings.section', 'settings.section.icon'],
  )

  const [section, icon] = registered
  assert.equal(section.descriptor.name, 'settings.section')
  assert.equal(section.descriptor.id, 'autorouter')
  assert.equal(section.descriptor.order, 16)
  assert.equal(section.descriptor.locale, 'settings.autorouter')
  assert.equal(section.descriptor.label(), 'settings.autorouter.nav')
  assert.equal(typeof section.component, 'function')

  assert.equal(icon.descriptor.name, 'settings.section.icon')
  assert.equal(icon.descriptor.id, 'autorouter')
  assert.equal(typeof icon.component, 'function')
})
