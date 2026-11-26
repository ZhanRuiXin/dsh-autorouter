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
  let registration
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
        assert.equal(name, 'settings.section')
        callback()
        return () => {}
      },
      register(descriptor, component) {
        registration = { descriptor, component }
        return () => {}
      },
    },
  }

  client.apply(ctx)

  assert.deepEqual(effects, ['autorouter: styles', 'autorouter: locale'])
  assert.equal(registration.descriptor.name, 'settings.section')
  assert.equal(registration.descriptor.id, 'autorouter')
  assert.equal(registration.descriptor.order, 16)
  assert.equal(registration.descriptor.locale, 'settings.autorouter')
  assert.equal(registration.descriptor.label(), 'settings.autorouter.nav')
  assert.equal(typeof registration.component, 'function')
})
