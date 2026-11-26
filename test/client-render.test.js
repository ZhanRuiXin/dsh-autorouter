/**
 * Renders the settings page without a browser.
 *
 * The client bundle is a bare `window.__ModuleLoader__.load({factory})` call and
 * there is no React, DOM or network here, so this file drives the component with
 * a small React double: `createElement` builds plain nodes, and `useState` is
 * fed by the scenario below. That is enough to execute the real markup code for
 * every tab — the point is catching a missing helper, a stale field or a broken
 * card boundary, not testing React itself.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const bundle = path.join(here, '..', 'client.js')

const flatten = (children) => children.flat(Infinity).filter((child) => child !== undefined)

function createElement(type, props, ...children) {
  return { type, props: { ...(props ?? {}), children: flatten(children) } }
}

// ---- the scenario ---------------------------------------------------------

const CONFIG = {
  enabled: true,
  profiles: [
    {
      id: 'auto',
      name: 'Auto',
      enabled: true,
      aliases: ['default'],
      chain: [
        {
          id: 'opendesign-flash-eco',
          enabled: true,
          provider: 'opendesign',
          model: 'deepseek-v4.1-flash-eco',
          label: 'OpenDesign · Flash Eco',
          cooldownMs: 300000,
          effortMap: {},
        },
        {
          id: 'deepseek-account-flash',
          enabled: true,
          provider: 'deepseek-account',
          model: 'deepseek-flash',
          label: 'DeepSeek · Flash',
          cooldownMs: 300000,
          effortMap: { max: 'high' },
        },
      ],
      policy: {
        utcOffsetMinutes: 480,
        sticky: true,
        maxSwitches: 8,
        cooldownMs: 300000,
        effortPolicy: 'clamp',
        contextPolicy: 'min',
        defaultContextWindow: 128000,
        triggerCodes: ['AUTH', 'QUOTA'],
        triggerStatuses: [429],
        timeWindows: [{ id: 'w', label: '谷时', from: 30, to: 510, order: ['deepseek-account/deepseek-flash'] }],
      },
    },
  ],
}

const STATUS = {
  routes: [
    {
      profileId: 'auto',
      entryId: 'opendesign-flash-eco',
      key: 'opendesign/deepseek-v4.1-flash-eco',
      provider: 'opendesign',
      model: 'deepseek-v4.1-flash-eco',
      label: 'OpenDesign · Flash Eco',
      enabled: true,
      failures: 0,
    },
    {
      profileId: 'auto',
      entryId: 'deepseek-account-flash',
      key: 'deepseek-account/deepseek-flash',
      provider: 'deepseek-account',
      model: 'deepseek-flash',
      label: 'DeepSeek · Flash',
      enabled: true,
      coolingUntil: Date.now() + 60000,
      failures: 2,
    },
  ],
  stats: { attempts: 5, successes: 3, failures: 1, switches: 1, lastRoute: 'opendesign/deepseek-v4.1-flash-eco' },
  sessions: [{ sessionId: 'abcdef123456', profileId: 'auto', key: 'opendesign/deepseek-v4.1-flash-eco', ageMs: 9000 }],
}

const CATALOG = {
  providers: [
    {
      id: 'opendesign',
      name: 'OpenDesign',
      models: [{ id: 'deepseek-v4.1-flash-eco', name: 'Flash Eco' }],
    },
    { id: 'deepseek-account', name: 'DeepSeek', models: [{ id: 'deepseek-flash', name: 'Flash' }] },
  ],
}

/**
 * One entry per `useState` of `AutoRouterSettings`, in call order. `kind` is
 * `value` for a literal initial value and `lazy` for an initializer function, so
 * inserting a hook shifts the list and fails loudly instead of rendering a
 * different page.
 */
const SETTINGS_STATE = [
  { kind: 'value', initial: true, value: false }, // loading
  { kind: 'value', initial: '', value: '' }, // error
  { kind: 'value', initial: '', value: '' }, // notice
  { kind: 'value', initial: null, value: CONFIG }, // draft
  { kind: 'value', initial: null, value: CONFIG }, // serverConfig
  { kind: 'value', initial: undefined, value: 7 }, // revision
  { kind: 'value', initial: null, value: STATUS }, // status
  { kind: 'value', initial: { providers: [] }, value: CATALOG }, // catalog
  { kind: 'value', initial: 'routes', value: 'routes' }, // tab  (overridden per render)
  { kind: 'value', initial: '', value: 'auto' }, // selected
  { kind: 'value', initial: false, value: false }, // busy
  { kind: 'value', initial: false, value: false }, // dirty
  { kind: 'value', initial: {}, value: {} }, // probes
  { kind: 'value', initial: '', value: JSON.stringify(CONFIG, null, 2) }, // jsonText
  { kind: 'value', initial: '', value: '' }, // jsonError
  { kind: 'lazy', value: 'light' }, // scheme
  { kind: 'lazy', value: new Set() }, // collapsed
]

function makeReact() {
  let scenario = []
  let slot = 0
  let active = false

  const useState = (initial) => {
    if (active) {
      const spec = scenario[slot]
      assert.ok(spec, `unexpected useState #${slot} — the hook list changed`)
      const isLazy = typeof initial === 'function'
      assert.equal(spec.kind, isLazy ? 'lazy' : 'value', `useState #${slot} changed its shape`)
      if (spec.kind === 'value') {
        assert.deepEqual(initial, spec.initial, `useState #${slot} initial value changed`)
      }
      slot += 1
      return [spec.value, () => {}]
    }
    return [typeof initial === 'function' ? initial() : initial, () => {}]
  }

  return {
    createElement,
    useState,
    useEffect: () => {},
    useRef: (initial) => ({ current: initial }),
    // helpers for the driver
    begin(activeScenario) {
      scenario = activeScenario
      slot = 0
      active = true
    },
    end() {
      active = false
      assert.equal(slot, scenario.length, 'the scenario must cover every useState of the settings page')
    },
  }
}

// ---- loading the bundle ---------------------------------------------------

function loadBundle() {
  const code = fs.readFileSync(bundle, 'utf8')
  const styles = []
  const slots = { section: [], icon: [] }
  let registration

  const documentStub = {
    documentElement: { getAttribute: () => null, classList: { contains: () => false } },
    body: null,
    head: { appendChild: () => {} },
    visibilityState: 'visible',
    createElement: (tagName) => {
      const element = { tagName, dataset: {}, remove: () => {} }
      let textContent = ''
      Object.defineProperty(element, 'textContent', {
        get: () => textContent,
        set: (value) => {
          textContent = value
          if (tagName === 'style') styles.push(value)
        },
      })
      return element
    },
  }

  const windowStub = {
    __ModuleLoader__: {
      load: (module) => {
        registration = module
      },
    },
    localStorage: {
      getItem: () => null,
      setItem: () => {},
    },
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  }

  const sandbox = {
    window: windowStub,
    document: documentStub,
    localStorage: windowStub.localStorage,
    structuredClone,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    fetch: async () => ({ json: async () => ({}) }),
    console,
    // captured for the assertions
    __styles: styles,
    __slots: slots,
  }

  const run = new Function(
    'window',
    'document',
    'localStorage',
    'structuredClone',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    'fetch',
    'console',
    'capture',
    code,
  )

  return (react) => {
    run(
      windowStub,
      documentStub,
      windowStub.localStorage,
      structuredClone,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      sandbox.fetch,
      console,
      (text) => styles.push(text),
    )
    assert.ok(registration, 'client.js must call window.__ModuleLoader__.load')
    const module = registration.factory((name) => {
      assert.equal(name, 'react')
      return react
    })
    const ctx = {
      effect: () => () => {},
      locale: {
        register: () => {},
        bind: () => (key) => (module.__dict?.[key] ?? key),
      },
      slots: {
        inject: (_name, callback) => callback(),
        register: (descriptor, component) => {
          if (descriptor.name === 'settings.section') slots.section.push({ descriptor, component })
          if (descriptor.name === 'settings.section.icon') slots.icon.push({ descriptor, component })
          return { descriptor, component }
        },
      },
    }
    module.apply(ctx)
    void sandbox
    return { module, slots, styles, document: documentStub }
  }
}

// ---- a renderer -----------------------------------------------------------

const isNode = (value) => value !== null && typeof value === 'object' && 'type' in value

function render(node, react, forceSettings) {
  if (node === null || node === undefined || typeof node === 'boolean') return null
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map((child) => render(child, react, forceSettings)).filter((child) => child !== null)
  if (!isNode(node)) return null
  const { type, props } = node
  if (typeof type === 'function') {
    const isSettings = type.name === 'AutoRouterSettings'
    if (isSettings && Array.isArray(forceSettings)) {
      // Hooks are consumed by this component's own body only: stop driving the
      // scenario before its children render, so a child hook (ProfileCard has
      // one) keeps its normal behaviour instead of shifting the list.
      react.begin(forceSettings)
      let output
      try {
        output = type(props)
      } finally {
        react.end()
      }
      return render(output, react, forceSettings)
    }
    return render(type(props), react, forceSettings)
  }
  return { type, props: { ...props, children: render(props.children, react, forceSettings) ?? [] } }
}

function walk(node, visit) {
  if (node === null || node === undefined) return
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, visit))
    return
  }
  if (typeof node !== 'object') return
  visit(node)
  const props = node.props ?? {}
  walk(props.children, visit)
  if (Array.isArray(props.head)) walk(props.head, visit)
  if (Array.isArray(props.actions)) walk(props.actions, visit)
}

function text(node) {
  if (node === null || node === undefined) return ''
  if (Array.isArray(node)) return node.map(text).join('')
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (!node.props) return ''
  return text(node.props.children)
}

function findAll(tree, predicate) {
  const hits = []
  walk(tree, (node) => {
    if (isNode(node) && predicate(node)) hits.push(node)
  })
  return hits
}

const classNames = (node) => (typeof node.props?.className === 'string' ? node.props.className.split(/\s+/) : [])

const hasClass = (name) => (node) => classNames(node).includes(name)

/** Exact class list — `ar-entry` must not match `ar-entry-main`. */
const hasClassList = (names) => (node) => {
  const own = classNames(node).filter(Boolean).sort()
  return own.length === names.length && names.every((name) => own.includes(name))
}

// ---- tests ----------------------------------------------------------------

function setup() {
  const react = makeReact()
  const { slots, styles, document } = loadBundle()(react)
  const dict = {}
  // the page's own text comes from the locale dictionary; using keys keeps the
  // assertions independent of the translation
  const locale = {
    register: (_ns, tables) => Object.assign(dict, tables.zh ?? {}),
  }
  const section = slots.section[0]
  assert.ok(section, 'settings.section must be registered')
  const icon = slots.icon[0]
  assert.ok(icon, 'settings.section.icon must be registered')
  return { react, slots, styles, document, section, icon, dict }
}

function renderPage(setupResult, { tab = 'routes', collapsed = [], scheme = 'light' } = {}) {
  const scenario = SETTINGS_STATE.map((spec) => ({ ...spec }))
  scenario[8].value = tab
  scenario[15].value = scheme
  scenario[16].value = new Set(collapsed)
  const page = setupResult.section.component
  const t = (key) => key
  const tree = render(createElement(page, { t, close: () => {} }), setupResult.react, scenario)
  return { tree, t }
}

test('the routes tab renders one card per profile plus the status card', () => {
  const setupResult = setup()
  const { tree } = renderPage(setupResult)

  const cards = findAll(tree, hasClass('ar-card'))
  assert.equal(cards.length, 2, 'one profile card and one status card')
  assert.equal(findAll(tree, hasClass('ar-chevron')).length, 2, 'every card carries a disclosure button')

  const expanded = findAll(tree, (node) => node.props?.['aria-expanded'] === true)
  assert.equal(expanded.length, 2)
  assert.equal(findAll(tree, hasClass('ar-card-body')).length, 2, 'open cards expose their body')

  const headers = findAll(tree, (node) => node.type === 'th').map(text)
  assert.deepEqual(headers, ['profile', 'provider', 'model', 'health', ''], 'no request-budget column')

  const rows = findAll(tree, (node) => node.type === 'tr')
  assert.equal(rows.length, 3, 'a header row and one row per route')

  const entryRows = findAll(tree, hasClassList(['ar-entry']))
  assert.equal(entryRows.length, 2)
  assert.ok(text(tree).includes('opendesign'), 'the chain renders its providers')
})

test('collapsed cards keep their head and drop the body', () => {
  const setupResult = setup()
  const { tree } = renderPage(setupResult, { collapsed: ['status'] })

  const cards = findAll(tree, hasClass('ar-card'))
  const status = cards.find((card) => text(card).includes('status'))
  assert.ok(status, 'the status card is still rendered')
  assert.ok(hasClass('collapsed')(status), 'a collapsed card is marked')
  assert.equal(findAll(status, hasClass('ar-card-body')).length, 0)

  const chevrons = findAll(tree, hasClass('ar-chevron'))
  assert.equal(chevrons.length, 2)
  assert.equal(chevrons.filter((node) => node.props['aria-expanded'] === false).length, 1)
  assert.ok(chevrons.some((node) => text(node) === '▸'))
})

test('the policy tab renders the policy card and the time windows', () => {
  const setupResult = setup()
  const { tree } = renderPage(setupResult, { tab: 'policy' })

  const cards = findAll(tree, hasClass('ar-card'))
  assert.equal(cards.length, 2, 'the policy card and the time-window card')
  const inputs = findAll(tree, (node) => node.type === 'input')
  assert.ok(inputs.length >= 14, `every policy field renders (got ${inputs.length})`)

  const timeInputs = inputs.filter((node) => node.props.type === 'time')
  assert.equal(timeInputs.length, 2, 'from/to clock fields for the one window')
  assert.equal(timeInputs[0].props.value, '00:30')
  assert.equal(timeInputs[1].props.value, '08:30')
  assert.ok(
    inputs.some((node) => node.props.value === '谷时'),
    'the window label is editable',
  )
})

test('the json tab renders the draft and its actions', () => {
  const setupResult = setup()
  const { tree } = renderPage(setupResult, { tab: 'json' })

  const textarea = findAll(tree, (node) => node.type === 'textarea')[0]
  assert.ok(textarea)
  assert.ok(textarea.props.value.includes('"profiles"'))
  // the header keeps its own save/reload pair above the tab body
  assert.equal(findAll(tree, hasClass('ar-btn')).length, 4, 'header actions plus apply and reload')
  assert.ok(text(tree).includes('applyJson'), 'the draft can be applied')
})

test('the stylesheet declares the disclosure and no budget styling', () => {
  const setupResult = setup()
  renderPage(setupResult)
  const css = setupResult.styles.join('\n')
  assert.ok(css.includes('.ar-chevron'))
  assert.ok(css.includes('.ar-card-body'))
  assert.ok(!css.includes('ar-budget'))
  assert.ok(css.includes('.ar-root[data-scheme="dark"] .ar-select option'), 'dark select popups keep their rule')
})

test('the nav icon renders a 24-unit svg that inherits the current colour', () => {
  const setupResult = setup()
  const icon = render(createElement(setupResult.icon.component, { size: 16 }), setupResult.react, false)
  assert.equal(icon.type, 'svg')
  assert.equal(icon.props.viewBox, '0 0 24 24')
  assert.equal(icon.props.stroke, 'currentColor')
  assert.equal(icon.props.width, 16)
  assert.equal(icon.props.children.length, 8, 'three terminals, one source and four paths')
})
