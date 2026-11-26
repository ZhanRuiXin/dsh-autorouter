# AutoRouter

[![powered by dsh](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness) [![DSH 0.2.x](https://img.shields.io/badge/DSH-0.2.x-4D6BFE?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness) [![license MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)

**A DSH plugin that makes every provider and model you already registered look like one provider, with a fallback chain behind it.**

**Version 0.3.0** · **Updated 2026-11-26**

<p align="center"><strong>English</strong> · <a href="docs/README.zh-CN.md">简体中文</a></p>

---

## Overview

AutoRouter registers one native DSH provider, `autorouter` (shown as **AutoRouter**), and routes each request along a chain of routes that already exist in the host. You keep using the credentials, dialects and model registrations DSH already knows; AutoRouter only decides which registered route serves this request, and what to do when that route fails.

It is not a proxy. Every attempt is dispatched through DSH's own `llm.stream()` to the provider that owns it, so images, attachments, tool history and replay state stay inside the adapter that understands them. There is no HTTP hop, no second key store, and no translation layer that could lose a field.

The plugin also owns the settings page under **Settings → AutoRouter**, where the chain, the per-window chains, the cooldowns and the live status are edited. Nothing about routing is hidden in a config file you have to hand-edit.

## At a glance

| | |
| --- | --- |
| **Visible surface** | One provider id, `autorouter`; one picker row per profile, `AutoRouter / <profile>` |
| **Routing** | The chain array is the order: top to bottom, first usable route wins. No weights, no cost or quality scoring |
| **Failover** | Only before the first output block; `block-start` and any content delta commit the attempt. After that a failure is forwarded, not switched |
| **Spend accounting** | `usage` never commits an attempt; it is buffered and replayed before a switch, so the number never disappears |
| **Quota** | No local budget. The upstream's 429 and the per-route failure count are the signal; a route that keeps failing cools down |
| **Reasoning effort** | Inherited: the virtual model advertises the union of the chain's efforts, each attempt maps the request onto the target, clamping by default |
| **Time windows** | A window is a name for one or more disjoint stretches of the day, and owns a **complete fallback chain** of its own |
| **Sessions** | Sticky by `sessionId` for the sticky TTL, which keeps the upstream prompt cache warm |
| **Runtime** | A native `LlmAdapter`; every attempt is a nested `llm.stream()` on an already registered route |

## Who it is for

- Setups with several routes for the same job — a subscription, a cheap mirror, an account with its own quota — where you want one picker entry instead of switching by hand.
- Work that must survive a route going down mid-project: `AUTH`, `QUOTA`, `RATE_LIMIT` and network failures move to the next route without touching the session.
- Anyone who wants the peak/off-peak ordering of the same routes to follow the clock instead of a manual switch.
- Users who would rather have the plan edited in a settings page than in YAML.

**Not for:** a single provider with a single key. Adding a chain of one only adds a layer; point the model at the route directly. It is also not a way to multiply one provider's quota — DSH binds one credential per route, so a "key pool" is a list of routes, each with its own credential.

## Requirements

AutoRouter is a **profile-level DSH bundle**. It installs nothing else and enables nothing else: the routes it walks are the ones your profile already has.

| Capability | Provider | Notes |
| --- | --- | --- |
| DSH | [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) `0.2.x` | Developed against `0.2.2-rc.3`; the LLM service contract it uses (`registerAdapter`, `resolveModelInfo`, `prepareCall`) is stable across the series |
| At least one registered route | your own provider rows | `autorouter` walks `llm.listProviders()`; a route with no credential resolves but fails at request time |
| Node | `>= 22` | The host runs it; only matters when you test the package outside DSH |

**Optional:** a fallback-chain plugin such as `dsh-llm-fallbacks` is not required and not used. If both are installed they are independent providers; keep one of them in the picker to avoid routing the same request through two layers.

If the profile has no route with a working credential, AutoRouter still loads and the settings page still works — the `试一次` button reports the upstream failure that a real request would get.

## Install

AutoRouter ships as a DSH bundle and is published on npm as `dsh-autorouter`.

### Install from the DSH plugins page

1. Open **Settings → Plugins** and click **Add**.
2. Paste the install spec: `dsh-autorouter@0.3.0` for the npm package, `github:ZhanRuiXin/dsh-autorouter#v0.3.0` to pin the source, or `link:/absolute/path/to/dsh-autorouter` for a local checkout.
3. **Restart DSH.** The host half registers the adapter and the HTTP routes at startup; the client half loads with the page.
4. Open **Settings → AutoRouter**, create a profile, and add the routes you want in the chain.

### Install from the CLI

```text
dsh plugin add dsh-autorouter@0.2.1
```

To pin the source instead of the registry:

```text
dsh plugin add github:ZhanRuiXin/dsh-autorouter#v0.2.1
```

> The bundle is profile-level: installing it in one profile does not enable it in another, and the settings page appears only in the profile where the row is enabled.

## First run

A fresh install ships **no route plan** on purpose: nothing is routed until you build a chain from the providers you actually have. Start by opening **Settings → AutoRouter**:

1. **+ New profile** — the profile id becomes the model id (`auto` → `AutoRouter / auto`).
2. **Add route** — pick a provider and a model from the registered ones. Repeat for each route; the order in the card is the order they are tried.
3. **Save**. The header version line should read `host v0.3.0`; if it says the host has not reported a version, DSH is still running the old process.
4. **Try once** on the status tab. It sends one real minimal request through `autorouter/<profile>` and reports the route that served it, the elapsed time and the text.
5. Pick `AutoRouter / <profile>` in the model picker, or point `agent-default-model` at `{ "provider": "autorouter", "model": "auto" }`.

A typical chain, in the order it is tried:

```text
AutoRouter / auto
├─ opendesign/deepseek-v4.1-flash-eco      cheap mirror, first when it is up
├─ commandcode/deepseek/deepseek-v4.1-flash
└─ deepseek-account/deepseek-flash          the account that must not be wasted
```

## How a request is routed

Candidate selection is `chain order → usability → active time window → sticky pin`. Usability drops a route that is cooling down; the window reorders what is left; the sticky pin moves the route that served this session last to the front.

An attempt is committed the moment the adapter yields `block-start`, text, reasoning or a tool-call delta. Before that, a terminal failure with a trigger code (`AUTH`, `QUOTA`, `RATE_LIMIT`, `NETWORK`, and the HTTP statuses in the trigger list) moves to the next route. After it, the failure is forwarded exactly as the upstream reported it: a half-streamed answer is never silently restarted on another provider.

That rule is about the *attempt*, not the conversation. A step is one `llm.stream()` call and every step re-selects its route, so a provider that dies mid-answer costs one step: the failure is still booked, the route is put in cooldown and the session loses its pin, and the next step starts somewhere else instead of retrying the dead route first.

A provider that accepts the connection and then stops sending is handled by the same machinery: with `attemptIdleMs` set (0 = off), an attempt that receives nothing for that long is aborted, classified as `NETWORK`, and either handed to the next route (nothing emitted yet) or reported as an error and booked (output already emitted).

A route that fails is booked and cools down (`cooldownMs`, `5` minutes by default, with optional jitter). Retry-After from the upstream is honoured when `honorRetryAfter` is on. Repeated failures inside `failureWindowMs` back off exponentially up to `backoffMaxMs`. A cooling route is skipped, not removed, and comes back on its own; the **live status** tab lists each one and can clear a single cooldown.

`maxSwitches` is a fuse, not a target: the walk stops after that many switches in one step and reports the last failure instead of looping.

## Reasoning effort

DSH's default agent model carries `reasoningEffort: max`, and a chain mixes routes that declare different effort sets — or none at all. AutoRouter handles that instead of letting the request die before any I/O:

- The virtual model advertises the **union** of the efforts declared along the chain, so `max` stays selectable even if one route only declares `low` and `high`.
- Each attempt resolves the request as `entry.effortMap[effort]` → the target's declared `defaultEffort` → omit the parameter. `effortPolicy` decides what happens when the target cannot take it: `clamp` (default) uses the closest declared effort, `drop` omits it, `fail` refuses the attempt.
- A target that declares no reasoning at all is a known-no-reasoning target: the parameter is dropped rather than forwarded, because forwarding it makes DSH reject the call before the adapter runs. If an upstream still answers `UNSUPPORTED_REASONING_EFFORT`, the parameter is removed and the same route is retried once — a route is never abandoned for a parameter the caller could not have known about.

## Time windows

A window is a label plus one or more `ranges` of local clock time, and it owns a complete ordering of the profile's routes. Hitting any of its ranges makes it the active window, and its `order` becomes the chain. Routes the window does not list keep their configured position and run last, so a window can never empty the candidate set.

```text
deepseek-offpeak   00:30–08:30, 22:00–23:30   deepseek-account/* first, everything else after
default order      the chain as edited on the default tab
```

Ranges are half-open (`from` inclusive, `to` exclusive) and wrap when `from > to`; `from === to` means all day. Local time is the profile's `utcOffsetMinutes` (UTC+8 by default), so the plan does not shift when the machine's zone changes. A legacy single `{ from, to }` is folded into one range automatically.

In the settings page the window buttons sit above the chain: pick a button and the arrows reorder **that window's** chain; pick `default order` to edit the chain used when no window matches. A new window starts as a copy of the current chain.

## The settings page

Three tabs, nothing else:

- **Routes** — one card per profile, the card head is the expand/collapse control. Inside, three sections separated by hairlines: **chain**, **time windows**, **policy**. There is no "selected profile": every setting lives in the card it belongs to, so a change can never land on a profile you were not looking at. **Copy** on the card head clones the whole profile — chain, windows and policy — one slot below the source, with `-copy` on the id (then `-copy-2`, …) and a marked display name, because the id is the model id the picker shows and two identical rows would be indistinguishable.
- **Live status** — cooldowns and failure counts per route, the sticky sessions, the request counters, `Try once`, and the `host vX.Y.Z` line. It is deliberately not on the routes tab: editing a chain should not have a table ticking every two seconds next to it.
- **JSON** — the whole configuration, editable, folded back into the form on apply.

**Save** is always clickable and answers with the configuration that was actually written, then refreshes the page from the server. **Undo** is the local inverse: it drops unsaved edits and restores the last saved configuration without a network round trip. Writes go through `settings.replace(ns, value, revision)`, so a stale tab gets `409` instead of overwriting someone else's save.

## Where settings are stored

The configuration lives in the profile patch row that the bundle inserts, and the settings page writes it back there:

```yaml
- id: llm-autorouter
  name: dsh-autorouter
  config:
    enabled: true
    profiles:
      - id: auto
        name: Auto
        chain: [ … ]
        policy: { maxSwitches: 8, cooldownMs: 300000, sticky: true, … }
```

```text
%USERPROFILE%\.dsh\profiles\<profile>\cordis.patch.yml     ($DSH_HOME/profiles/<profile>/cordis.patch.yml)
```

- The row id is `llm-autorouter`; the bundle's own patch inserts it as `include:llm-autorouter`, and the host matches `llm-autorouter`, `include:llm-autorouter`, then `*:llm-autorouter` instead of hard-coding one name.
- The config schema must stay `volatile` (`z.object({…}).extra('volatile', true)`). `settings.describe()` only projects config with a volatile field; without it the entry is skipped and every save reports `no profile entry`.
- The JSON tab is the escape hatch for a hand-edited document; a field AutoRouter does not know is preserved, an illegal route is dropped by `normalizeConfig` rather than crashing the walk.
- Cooldowns, counters and sticky sessions are **in-process**: a restart clears them, and they describe failures seen on this machine, not the upstream's real quota.

## Configuration reference

| Setting | Where | Notes |
| --- | --- | --- |
| `profiles[].id` | config | Becomes the model id: `autorouter/<id>`; also the display name in the picker |
| `profiles[].chain[]` | config | Ordered routes; `provider` + `model` must exist in the host. `cooldownMs` and `effortMap` are per route |
| `profiles[].policy.maxSwitches` | config | Fuse for one step; the walk stops instead of looping |
| `policy.cooldownMs` / `cooldownJitterRatio` | config | Cooldown after a booked failure, plus optional spread so routes do not come back in lockstep |
| `policy.sticky` / `stickinessTtlMs` | config | Session stickiness and how long a pin survives before the route is re-chosen |
| `policy.triggerCodes` / `triggerStatuses` | config | What counts as "switch to the next route"; anything else is forwarded |
| `policy.honorRetryAfter` / `retryOnNetwork` | config | Upstream `Retry-After`, and whether transport failures are retryable |
| `policy.attemptIdleMs` | config | Abort an attempt that sends nothing for this long and treat it as `NETWORK`; `0` (default) waits for the host |
| `policy.effortPolicy` / `contextPolicy` | config | `clamp` / `drop` / `fail`; `min` / `max` for the advertised context window |
| `policy.timeWindows[]` | config | `{ id, label, ranges[], utcOffsetMinutes, order[] }`; `order` is the window's full chain |
| `/api/autorouter/*` | host | Same-origin HTTP surface used by the page; `auth: 'required'` on the existing DSH port |

## How it works

- **Adapter** — `src/adapter.js` extends `LlmAdapter` and registers the single provider `autorouter`. `listModels` returns one row per profile, `resolveModel` builds the virtual model info from the chain (effort union, smallest known context window, `toolUpdate` taken conservatively), and `stream` hands the request to the walk.
- **Walk** — `src/router/walk.js` iterates the candidates, dispatches each attempt as a nested `llm.stream()` on the real provider, buffers `usage`, and re-throws only when it is before any output. It owns the fuse, the parameter repair and the replay envelope.
- **Classify** — `src/router/classify.js` turns a terminal finish into a switch/skip/forward decision from the trigger set, the status code and the request-scoped codes DSH reports (a request that is too big is not a broken route).
- **Effort** — `src/router/effort.js` builds the union, resolves one attempt's effort and reports the coercion so the transcript can explain a dropped `max`.
- **State** — `src/state.js` holds cooldowns, failure windows, counters and session pins; everything is in-process and disposable.
- **HTTP + client** — `src/http.js` serves `/api/autorouter/{state,config,catalog,probe,cooldown,selection,try}`, `index.js` wires the adapter, the routes and the settings row, and `client.js` registers the settings section plus its nav icon.

`src/config.js`, `src/state.js` and `src/router/*` do not import `@deepseek-ai/*`, so the routing core runs and tests outside DSH; `test/plugin.test.js` stubs the peers for the integration path, and `test/client-render.test.js` renders the real page with a small React double.

## Troubleshooting

### The settings page saves, then shows the old values

The page asks the host for the configuration right after saving, and the host used to answer from a projection that lagged the write. Version `0.1.9` fixed it: the save response carries the configuration that was written, and the page no longer refetches the draft afterwards. If you still see it, check the `host vX.Y.Z` line — a host older than `0.1.9` is running the old code path.

### `no profile entry "llm-autorouter"` on save

`settings.describe()` had no entry for this plugin, so the write had nowhere to land. Two causes, in order of likelihood:

- the running host is older than `0.1.2`, which is when the config schema was marked volatile;
- the bundle is installed but not enabled in this profile.

Restart DSH after updating and confirm the row is enabled in **Settings → Plugins**.

### No `AutoRouter` row in the model picker

The adapter is registered by the host half at startup. Restart DSH and reload the page; a client-only refresh cannot register a provider. If the row is still missing, `cordis_inspect` on the `llm` service should list `autorouter` among the providers.

### The routes tab says there is no profile yet

That is the shipped default: a fresh install routes nothing. Use **+ New profile**, add routes, save. An existing configuration is never rewritten by an upgrade.

### `Try once` answers 404

The `/api/autorouter/try` route only exists in `0.1.10` and later. Restart DSH on the current build; the page names this case explicitly instead of showing a generic failure.

### A route fails with `UNSUPPORTED_REASONING_EFFORT`

Fixed in `0.1.12`: an effort the target cannot declare is dropped (or clamped) instead of being forwarded, and a route that still rejects the parameter is retried once without it. If you see it on a current build, the profile's `effortPolicy` is `fail` — that is the setting refusing the call on purpose.

### A route stays in cooldown

Cooldowns are per route and per process. The **live status** tab shows the remaining time and clears a single route; a restart clears all of them. Nothing is persisted, so an upgrade or restart does not inherit a stale cooldown.

## Known limitations

- The assistant message source is recorded as `autorouter/<profile>`, so DSH does not retain the upstream `replayState`. Every turn resends the full history; the upstream prompt cache still helps, but a replay-style adapter gets no delta. Preserving it needs a route-tagged envelope and a source rewrite, which the host contract does not expose today.
- Cooldowns, counters and sticky pins are in-process. A restart starts from zero, and the numbers describe this machine's experience, not the upstream's quota ledger.
- The catalog only lists what DSH has registered. Nothing is discovered over the network, so a provider that is out of favour but still registered stays selectable.
- The model picker shows `AutoRouter / <profile>`; the profile id is the model id, so renaming a profile changes the model a session must ask for.
- There is no HTTP facade: AutoRouter is a native adapter, not an OpenAI-compatible endpoint. A `baseURL` gateway that would let non-DSH clients share the same chain is a separate design (`DESIGN.md` §9) and is not implemented.

## License

MIT. See [LICENSE](LICENSE).

## Acknowledgements

Built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and [Cordis](https://github.com/cordiverse/cordis). The failover contract deliberately copies the one `dsh-llm-fallbacks` established — switch only before output, book failures, never restart a half-streamed answer — so a session behaves the same whichever router is in the picker.

Design notes, the host contract this plugin is built against, and the failure matrix live in [DESIGN.md](DESIGN.md); the release history is in [CHANGELOG.md](CHANGELOG.md).
