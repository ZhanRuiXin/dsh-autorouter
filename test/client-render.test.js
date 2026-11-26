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
        timeWindows: [
      {
        id: 'w',
        label: '谷时',
        // One named window over two disjoint stretches of the day.
        ranges: [
          { from: 30, to: 510 },
          { from: 1320, to: 1410 },
        ],
        order: ['deepseek-account/deepseek-flash'],
      },
    ],
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
  // Child components render inside their own hook scope: nothing is asserted
  // there, but a test may pin one child's initial state (the chain editor opens
  // on the "default" tab otherwise, so a window tab would never render).
  const childStack = []
  const overrides = {}

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
    const scope = childStack[childStack.length - 1]
    if (scope !== undefined) {
      const index = scope.slot
      scope.slot += 1
      const pinned = overrides[scope.name]
      if (Array.isArray(pinned) && index < pinned.length) return [pinned[index], () => {}]
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
    beginChild(name) {
      childStack.push({ name, slot: 0 })
    },
    endChild() {
      childStack.pop()
    },
    override(name, values) {
      overrides[name] = values
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
      effect: (callback) => {
        const dispose = callback()
        return () => dispose?.()
      },
      locale: {
        register: (ns, tables) => {
          localeSink?.(ns, tables)
        },
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

/** Render one plain component inside its own hook scope. */
function childScope(react, type, props) {
  react.beginChild(type.name)
  try {
    return type(props)
  } finally {
    react.endChild()
  }
}

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
    return render(childScope(react, type, props), react, forceSettings)
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

let localeSink = undefined

function setup() {
  const react = makeReact()
  const dict = {}
  const locales = {}
  // the page's own text comes from the locale dictionary; using keys keeps the
  // assertions independent of the translation
  localeSink = (_ns, tables) => {
    Object.assign(dict, tables.zh ?? {})
    Object.assign(locales, tables)
  }
  const { slots, styles, document } = loadBundle()(react)
  const section = slots.section[0]
  assert.ok(section, 'settings.section must be registered')
  const icon = slots.icon[0]
  assert.ok(icon, 'settings.section.icon must be registered')
  return { react, slots, styles, document, section, icon, dict, locales }
}

function renderPage(setupResult, { tab = 'routes', collapsed = [], scheme = 'light', dirty = false, config = CONFIG } = {}) {
  const scenario = SETTINGS_STATE.map((spec) => ({ ...spec }))
  scenario[3].value = config
  scenario[4].value = config
  scenario[8].value = tab
  scenario[10].value = dirty
  scenario[14].value = scheme
  scenario[15].value = new Set(collapsed)
  const page = setupResult.section.component
  const t = (key) => key
  const tree = render(createElement(page, { t, close: () => {} }), setupResult.react, scenario)
  return { tree, t }
}

test('the routes tab renders one card per profile, without the status card', () => {
  const setupResult = setup()
  const { tree } = renderPage(setupResult)

  const cards = findAll(tree, hasClass('ar-card'))
  assert.equal(cards.length, 1, 'the live status moved off this tab, so one profile means one card')
  // One chevron on the card head, one on the policy section inside it.
  assert.equal(findAll(tree, hasClass('ar-chevron')).length, 2, 'the card and its policy section both collapse')
  assert.equal(findAll(tree, hasClass('ar-card-body')).length, 1, 'an open card exposes its body')

  assert.equal(findAll(tree, (node) => node.type === 'table').length, 0, 'no live route table on the chain tab')
  assert.equal(findAll(tree, (node) => node.type === 'th').length, 0)

  const entryRows = findAll(tree, hasClassList(['ar-entry']))
  assert.equal(entryRows.length, 2)
  assert.ok(text(tree).includes('OpenDesign'), 'the chain renders its routes')

  // The head is text only: nothing in it selects a profile any more, because
  // the policy and the windows moved into the card itself.
  assert.equal(findAll(tree, (node) => node.props?.type === 'radio').length, 0, 'no unlabelled selector dot')
  assert.equal(findAll(tree, (node) => node.type === 'button' && text(node) === 'policy').length, 0, 'no policy tab')
  // A profile is always routable: the enable switch said nothing a user needs.
  assert.equal(findAll(tree, (node) => text(node) === 'profileEnabled').length, 0, 'a profile carries no enable switch')
  assert.equal(findAll(tree, (node) => text(node) === 'enabled').length, 0, 'the header carries no gateway switch either')
  const entryRowsAgain = findAll(tree, hasClassList(['ar-entry']))
  assert.equal(
    findAll(entryRowsAgain[0], (node) => node.props?.type === 'checkbox').length,
    1,
    'a route row still carries exactly its own checkbox',
  )
})

test('both locales carry exactly the same keys', () => {
  const { locales } = setup()
  const zh = Object.keys(locales.zh ?? {}).sort()
  const en = Object.keys(locales.en ?? {}).sort()
  assert.ok(zh.length > 100, 'the dictionary is the page text, not a stub')
  assert.deepEqual(en, zh, 'a missing translation would fall back to the other language mid-page')
})

test('every key the page asks for exists in both locales', () => {
  const { locales } = setup()
  const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const used = new Set([...source.matchAll(/\bt\('([A-Za-z0-9_]+)'\)/g)].map((match) => match[1]))
  assert.ok(used.size > 80, 'the scan sees the page text')
  const missing = [...used].filter((key) => !(key in (locales.zh ?? {})) || !(key in (locales.en ?? {})))
  assert.deepEqual(missing, [], 'every label has a translation in both languages')
})

test('a fresh install explains the empty page instead of showing nothing', () => {
  const setupResult = setup()
  const { tree } = renderPage(setupResult, { config: { enabled: true, profiles: [], gateway: {}, service: {} } })

  assert.equal(findAll(tree, hasClass('ar-card')).length, 0, 'no profile means no card')
  assert.equal(findAll(tree, hasClass('ar-empty')).length, 1, 'the page says what to do next')
  assert.ok(text(tree).includes('noProfiles'))
  const labels = findAll(tree, (node) => node.type === 'button').map(text)
  assert.ok(labels.includes('+ addProfile'), 'the way forward is still one click away')
})

test('the status tab owns the live route table', () => {
  const setupResult = setup()
  const { tree } = renderPage(setupResult, { tab: 'status' })

  assert.equal(findAll(tree, hasClass('ar-card')).length, 1, 'the status card lives alone on its tab')

  const headers = findAll(tree, (node) => node.type === 'th').map(text)
  assert.deepEqual(headers, ['profile', 'provider', 'model', 'health', ''], 'no request-budget column')

  const rows = findAll(tree, (node) => node.type === 'tr')
  assert.equal(rows.length, 3, 'a header row and one row per route')

  assert.ok(text(tree).includes('cooling'), 'a cooling route shows its badge')

  const labels = findAll(tree, (node) => node.type === 'button').map(text)
  assert.ok(labels.includes('tryOnce'), 'the status card can send one real request through the router')
  assert.ok(text(tree).includes('hostVersionUnknown'), 'the page says so when the host reports no plugin version')
  assert.ok(text(tree).includes('abcdef12'), 'the sticky session is listed')
})

test('collapsed cards keep their head and drop the body', () => {
  const setupResult = setup()
  const { tree } = renderPage(setupResult, { tab: 'status', collapsed: ['status'] })

  const cards = findAll(tree, hasClass('ar-card'))
  assert.equal(cards.length, 1)
  const status = cards[0]
  assert.ok(hasClass('collapsed')(status), 'a collapsed card is marked')
  assert.equal(findAll(status, hasClass('ar-card-body')).length, 0)

  const chevrons = findAll(tree, hasClass('ar-chevron'))
  assert.equal(chevrons.length, 1)
  assert.equal(chevrons.filter((node) => node.props['aria-expanded'] === false).length, 1)
  assert.ok(chevrons.some((node) => text(node) === '▸'))
})

test('the time windows and the policy live inside the profile card', () => {
  const setupResult = setup()
  const { tree } = renderPage(setupResult)

  const card = findAll(tree, hasClassList(['ar-card']))[0]
  assert.ok(card, 'the profile card renders')

  const inputs = findAll(card, (node) => node.type === 'input')
  const timeInputs = inputs.filter((node) => node.props.type === 'time')
  assert.deepEqual(
    timeInputs.map((node) => node.props.value),
    ['00:30', '08:30', '22:00', '23:30'],
    'one from/to pair per stretch of the one window',
  )
  assert.ok(
    inputs.some((node) => node.props.value === '谷时'),
    'the window label is editable',
  )

  const numbers = inputs.filter((node) => node.props.type === 'number')
  assert.ok(numbers.length >= 8, `every policy field renders inside the card (got ${numbers.length})`)

  // The card is split into titled sections instead of tabs or floating
  // disclosures, so the windows and the policy read as parts of the card.
  const sections = findAll(card, hasClass('ar-section'))
  assert.equal(sections.length, 3, 'chain, time windows and policy')
  const titles = sections.map((node) => findAll(node, hasClass('ar-section-title')).map(text)[0])
  assert.deepEqual(titles, ['chain', 'timeWindows', 'policy'])

  // Which routes come first in a window is that window's own fallback chain,
  // edited on the chain itself through the tab row above it.
  assert.equal(findAll(card, hasClass('ar-chip')).length, 0, 'priority chips are gone')
  const orderTabs = findAll(card, hasClass('ar-order-tabs'))[0]
  assert.ok(orderTabs, 'the chain carries an order-tab row')
  const tabs = findAll(orderTabs, (node) => node.type === 'button')
  assert.equal(tabs.length, 2, 'the configured order plus one per window')
  assert.equal(text(tabs[0]), 'defaultOrder')
  // The active-window dot depends on the clock, so match the label, not the
  // whole caption.
  assert.ok(text(tabs[1]).includes('谷时'), 'a window tab is labelled with the window')
  assert.ok(hasClass('primary')(tabs[0]), 'the configured order is selected by default')
  assert.ok(
    findAll(card, hasClass('ar-order-preview')).some((node) => text(node).includes('deepseek-account/deepseek-flash')),
    'the window previews the order it will use',
  )

  // The only remaining <details> are the per-route effort maps.
  const details = findAll(card, hasClass('ar-details'))
  assert.equal(details.length, 2, 'effort maps stay disclosures; windows and policy are sections')
})

test('a time window is edited as a complete fallback chain of its own', () => {
  const setupResult = setup()
  setupResult.react.override('ProfileCard', ['w'])
  const { tree } = renderPage(setupResult)

  const card = findAll(tree, hasClassList(['ar-card']))[0]
  const tabs = findAll(findAll(card, hasClass('ar-order-tabs'))[0], (node) => node.type === 'button')
  assert.ok(hasClass('primary')(tabs[1]), 'the selected window owns the chain editor')

  // The window puts the DeepSeek route first, so the rows follow that order.
  const rows = findAll(card, hasClassList(['ar-entry']))
  assert.equal(rows.length, 2)
  const providerOf = (row) => findAll(row, (node) => node.type === 'select')[0]?.props.value
  assert.equal(providerOf(rows[0]), 'deepseek-account', 'the window order leads the rows')
  assert.equal(providerOf(rows[1]), 'opendesign')
  assert.ok(text(card).includes('orderTabHint'), 'the page says which order is being edited')
})

test('save is always available and undo is its local inverse', () => {
  const clean = renderPage(setup())
  const cleanButtons = findAll(clean.tree, (node) => node.type === 'button' && hasClass('ar-btn')(node))
  const cleanSave = cleanButtons.find((node) => text(node) === 'save')
  const cleanUndo = cleanButtons.find((node) => text(node) === 'undo')
  assert.ok(cleanSave, 'the header keeps a save button')
  assert.equal(cleanSave.props.disabled, false, 'saving must not depend on a dirty flag')
  assert.ok(cleanUndo, 'the reload button became undo')
  assert.equal(cleanUndo.props.disabled, true, 'nothing to undo while the draft is clean')

  const dirty = renderPage(setup(), { dirty: true })
  const dirtyButtons = findAll(dirty.tree, (node) => node.type === 'button' && hasClass('ar-btn')(node))
  assert.equal(dirtyButtons.find((node) => text(node) === 'undo').props.disabled, false, 'dirty edits can be undone')
  assert.ok(text(dirty.tree).includes('dirty'), 'the dirty badge is shown')
})

test('the json tab renders the draft and its actions', () => {
  const setupResult = setup()
  const { tree } = renderPage(setupResult, { tab: 'json' })

  const textarea = findAll(tree, (node) => node.type === 'textarea')[0]
  assert.ok(textarea)
  assert.ok(textarea.props.value.includes('"profiles"'))
  // header save/undo plus apply/undo under the textarea
  assert.equal(findAll(tree, hasClass('ar-btn')).length, 4, 'header actions plus apply and undo')
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
