# Changelog

Notable changes to `dsh-autorouter`. The shape follows
[Keep a Changelog](https://keepachangelog.com/) and the project uses semantic versioning.
Every version below was a working bundle: the suite passes on each tagged commit.

## Unreleased

- **a fresh install ships no route plan**: `DEFAULT_PROFILE` is gone and
`normalizeConfig` no longer re-adds default profiles, so nothing is routed until the
operator builds a chain from the providers they actually have credentials for. The routes tab
explains the empty state, and an unknown model reports "no profile yet" instead of a
four-entry list. A configuration that already exists on disk is never rewritten.
- locale completeness is now a test, not a habit: both dictionaries must carry the same keys,
and every `t('…')` the page uses must exist in both.
- README is English-first with a Chinese translation next to it; the package gained a
licence, keywords and author metadata.

## 0.1.15
- feat(ui): drop the gateway enable switch too

## 0.1.14
- feat(ui): drop the per-profile enable switch
- docs: describe the post-restart self-check and the current behaviour

## 0.1.13
- fix: never report a failed routed call as success

## 0.1.12
- fix: drop an effort the target cannot declare instead of failing the call

## 0.1.11
- fix: never hand the host metadata its validator rejects

## 0.1.10
- feat: drop the peak/off-peak preset and let the page try one real request
- fix(ui): name the old-host case when the try check has no route

## 0.1.9
- fix: answer a save with the written config, not a lagging projection
- feat: show which host build the page is talking to

## 0.1.8
- feat: let one named time window cover several disjoint stretches

## 0.1.7
- feat(ui): give every time window its own fallback chain

## 0.1.6
- fix(ui): fold time windows and policy into the card as visible sections

## 0.1.5
- feat(ui): keep windows and policy inside each profile card, split live status into its own tab

## 0.1.4
- feat: drop the request budget and let the settings cards collapse
- chore: pin line endings to LF so a checkout never rewrites the sources
- fix(ui): drop the unlabelled selector dot from the profile card

## 0.1.3
- feat: route strictly by chain order and add peak/off-peak time windows
- docs(ui): explain the request budget and drop dead weight labels
- fix: await settings.replace so a save response carries the new revision

## 0.1.2
- fix: mark the Config schema volatile so settings.describe projects it

## 0.1.1
- fix: declare @deepseek-ai peers so the linked bundle resolves at import
- test: boot apply() and client registration against stubbed peers
- docs: record the peerDependencies rule and the recompose-without-restart path
- fix(client): keep profile input focus, follow host dark scheme, add nav icon
- fix: resolve the settings row by entry id, follow the painted theme for select popups
- docs: the settings section needs a profile row

## 0.1.0
- feat: AutoRouter provider with settings page, routing core and tests
- fix(http): probe provider directory shapes and keep conflict config live
