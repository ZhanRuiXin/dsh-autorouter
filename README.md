# AutoRouter (`dsh-autorouter`)

English | [简体中文](README.zh-CN.md)

A DSH plugin that folds the provider/model routes **already registered in DSH** into one
virtual provider, `AutoRouter`, so DSH itself only ever sees the single route `autorouter`.

It does not proxy HTTP and it does not hold keys. Every upstream attempt is dispatched
through DSH's own `llm.stream()`, so each vendor's dialect, credentials, images and
attachments, tool history and replay state stay with the adapter that already knows them.

```
DSH ──► autorouter/<profile> ──► fallback chain
                                  ├─ opendesign/deepseek-v4.1-flash-eco
                                  ├─ commandcode/deepseek/deepseek-v4.1-flash
                                  └─ deepseek-account/deepseek-flash
```

## What it does

- **One virtual route, many upstreams**: `AutoRouter / auto`, plus as many extra profiles as
  you want — one profile is one chain.
- **Switches only before the first output block**: `block-start`, text, reasoning and
  tool-call deltas all commit the attempt; a failure after that is forwarded as-is instead of
  switching. `usage` does not commit, but it is buffered and replayed before a switch, so the
  spend is never lost.
- **Cooldown and recovery**: a failed route cools down (honouring `Retry-After` when the
  upstream sends one, with half-open recovery), and a cooling route never enters the
  candidate set. AutoRouter keeps no request budget: the upstream's 429 is the real quota
  signal, and a local ledger only invents rate limits nobody can see.
- **The settings page is the UI**: chain editing, cooldown, trigger codes, time windows,
  reasoning-effort mapping and live status all live under **Settings → AutoRouter**. Cards
  collapse (the state is remembered in `localStorage`), and every write still goes through the
  revision-checked settings document.
- **Session stickiness**: the same `sessionId` prefers the route that served it last, which
  keeps the upstream prompt cache warm; a route is only re-chosen when the session passes its
  TTL or that route fails.
- **Reasoning effort is inherited**: the virtual model advertises the union of the efforts
  declared along the chain; each attempt resolves the requested effort through
  `effortMap` → the target's `defaultEffort` → omit, clamping by default (switchable to
  `fail` or `drop`). If an upstream answers `UNSUPPORTED_REASONING_EFFORT` anyway, the
  parameter is dropped and the same route is retried once.
- **Capabilities take the intersection, or the conservative value**: input modalities are
  intersected, the context window is the smallest known one, and `toolUpdate` is declared
  `addition-only` as soon as one route in the chain requires it.

## Install

This repository is installed into a profile with `link:`:

```jsonc
// %USERPROFILE%\.dsh\profiles\desktop\package.json  (or $DSH_HOME/profiles/desktop/package.json)
"dependencies": { "dsh-autorouter": "link:E:/Repositories/Deepseek Harness/auto-provider-router" },
"dsh": { "profile": { "bundles": [ /* … other bundles … */, "dsh-autorouter" ] } }
```

DSH resolves `@deepseek-ai/*` for a plugin only when that plugin declares them in
`peerDependencies`. This package therefore declares `@deepseek-ai/schemastery` and
`@deepseek-ai/dsh-llm`; without them the process reports
`Cannot find package '@deepseek-ai/schemastery'` and the plugin row stays `inactive`
(`cordis_inspect` will not show its Config as `schema`).

Whether the settings page appears is decided by the schema, not by the profile row.
`settings.describe()` only projects config that carries `meta.volatile`: `volatileForm()`
returns `undefined` when it cannot find a volatile field anywhere in the schema, the entry is
skipped entirely, and saving reports `no profile entry`. So `Config` must be marked live:

```js
export const Config = z.object({ /* … */ }).extra('volatile', true)
```

The row inserted by the bundle's own patch has the id `include:llm-autorouter`, and
`describe()` reuses that id as its `ns`. The host side therefore matches `llm-autorouter`,
then `include:llm-autorouter`, then `*:llm-autorouter`, instead of hard-coding one name.
Adding a profile row of the same name is not required, but it lets you override the default
`config`:

```yaml
- id: llm-autorouter
  name: dsh-autorouter
  config: {}
```

Once it is installed (or after files change), recompose the plugin row:
`plugin_manager set_plugin { target: "include:llm-autorouter", enabled: true }`.
That only recomposes the bundle row — a change to host-side JS still needs a process restart,
while a client-bundle change only needs a page refresh. After restarting DSH:

1. **Settings → AutoRouter** shows the settings page;
2. the model picker lists `AutoRouter / auto`;
3. pick it, or point `agent-default-model` at `{ provider: "autorouter", model: "auto" }`.

## Settings page

The page has exactly three tabs: **routes**, **live status** and **JSON**.

- **Routes**: one card per profile, and the card head is the expand/collapse control
  (clicking the title works too). Inside, three sections separated by hairlines — **chain**,
  **time windows** and **policy** — are all visible and collapse with the card; there is no
  longer any need to "select" a profile first, and no floating settings block outside a card.
  Above the chain sits a row of window buttons (`default order` plus one per window). The
  button you pick decides which chain you are editing: the up/down arrows reorder **that
  window's own fallback chain**, while `default order` edits the chain used when no window
  matches. Routes a window does not list still run last as a fallback, so a window can never
  empty the candidate set. Routes are picked from the registered providers and models, and
  `Probe` only checks metadata reachability (list models plus resolve model info) — it does
  not send a real request.
- **Live status**: cooldown and failure counts per route, stats and sticky sessions, with a
  per-route cooldown reset. It deliberately does not sit on the routes tab, so editing a chain
  is not disturbed by a table that ticks every two seconds.
- **JSON**: edit the whole configuration and fold it back into the form.

Two header buttons: **Save** is always clickable (you do not have to make a change first) and
refreshes the configuration and version on the page as soon as it succeeds; **Undo** throws
away unsaved edits and returns to the last saved configuration without talking to the server.

The **live status** tab also has **Try once** in its top right corner: it sends one real
minimal request through `autorouter/<profile>` (default prompt
`Reply with the single word: ok`, `maxTokens` 24) and returns the route that served it, the
elapsed time and the text, or the terminal reason when it fails. The status card shows
`host vX.Y.Z` — the version the host itself reports. If it does not match `package.json`, DSH
is still running the old process and host-side edits cannot have taken effect.

The page talks to the host over same-origin `/api/autorouter/*`, and configuration writes
still go through `settings.replace(ns, value, revision)`, so concurrent edits are protected
(a 409 asks you to reload).

## Configuration

The configuration lives in the `config` of the profile row `llm-autorouter` and is written
back by the settings page. Normalisation happens in `normalizeConfig` in `src/config.js`:
every number is bounded, illegal, self-referential or duplicate routes are dropped, and each
profile needs at least one chain.

```jsonc
{
  "enabled": true,
  "debug": false,
  "profiles": [{
    "id": "auto", "name": "Auto", "enabled": true,
    "policy": { "maxSwitches": 8, "cooldownMs": 300000, "sticky": true,
                "effortPolicy": "clamp", "contextPolicy": "min",
                "timeWindows": [
                  { "id": "offpeak", "label": "off-peak",
                    "ranges": [{ "from": "00:30", "to": "08:30" },
                               { "from": "22:00", "to": "23:30" }],
                    "order": ["deepseek-account/deepseek-flash"] }
                ] },
    "chain": [
      { "id": "od", "provider": "opendesign", "model": "deepseek-v4.1-flash-eco",
        "cooldownMs": 300000 },
      { "id": "cc", "provider": "commandcode", "model": "deepseek/deepseek-v4.1-flash",
        "cooldownMs": 300000 },
      { "id": "ds", "provider": "deepseek-account", "model": "deepseek-flash",
        "cooldownMs": 300000 }
    ]
  }]
}
```

## Routing order

The chain array **is** the try order: top to bottom, the first usable route wins. There is no
weighted rotation and no quality or cost scoring. An attempt only advances to the next route
when it fails **before any output** and its error code or HTTP status matches the trigger set;
once the first content block arrives, the failure is reported as-is.

**Time windows** do not change the route set, only the order: the window matching local time
(UTC+8 by default) has **its own fallback chain** — what is stored is a list of route keys in
`order`, i.e. the complete ordering — and routes it does not list keep their configured
position at the end as a fallback. One window may cover several **disjoint** stretches of the
day (`ranges`, for example 00:30–08:30 plus 22:00–23:30); hitting any of them counts, and they
share the one chain. A legacy single `{ from, to }` is folded into one range automatically, so
no migration is needed.

The settings page switches which chain you edit with the window buttons above the chain, so
"a different fallback chain per time window" is simply a matter of picking a button and
reordering. A new window starts as a complete copy of the current chain and is then ordered
independently.

## Host API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/autorouter/state` | revision, redacted configuration and runtime state (cooldowns, stats, sticky sessions) |
| GET/PUT | `/api/autorouter/config` | read/write the configuration; PUT carries `{value, revision}` |
| GET | `/api/autorouter/catalog` | registered providers and models (excluding `autorouter`) |
| POST | `/api/autorouter/probe` | `{provider, model}` metadata reachability check |
| POST | `/api/autorouter/cooldown` | `{key}` clears one cooldown, `{}` clears all |
| GET | `/api/autorouter/selection` | current candidate order and blocking reason per profile |

Every route is `auth: 'required'` and is served on the DSH port that already exists — no extra
listener is opened.

## Known limitations

- The assistant message source is recorded as `autorouter/<profile>`, so DSH does not retain
  the upstream `replayState`; every turn resends the full history (the upstream prompt cache
  still helps, but replay-style adapters get no delta).
- Cooldowns and stats are in-process and reset when DSH restarts; they reflect failures
  observed on this machine, not the upstream's real quota.
- The catalog only reflects models DSH has registered; nothing is probed over the network.

## Development

```bash
node --test "test/*.test.js"
```

`src/config.js`, `src/state.js` and `src/router/*` do not depend on `@deepseek-ai/*`, so they
unit-test outside DSH. `test/plugin.test.js` maps `@deepseek-ai/dsh-llm` and
`@deepseek-ai/schemastery` to local stubs through `test/stubs/hooks.mjs`, which means
`apply()`, the request/response cycle of the HTTP routes (including the 409 revision conflict)
and the registration shape of `client.js` run under plain Node. `test/client-render.test.js`
needs no browser: a tiny React double drives the real rendering code in `client.js`, tab by
tab (chains and per-window fallback chains, live status, JSON, collapsed state, nav icon). The
`useState` call order is pinned in `SETTINGS_STATE`, so inserting a hook fails the test instead
of quietly rendering a different page, and a child component's initial state can be pinned with
`react.override('ProfileCard', ['w'])` to render one window's chain.

One real completion still has to be confirmed inside DSH.

## License

MIT — see [LICENSE](LICENSE).
