# Emotion lenses tool audit — 2026-03-14

**Bead:** `ee-cwi.4`  
**Status:** Audit complete; substantive alignment deferred  
**Canonical contract owner:** `../emotion-engine`

---

## Scope

Audit the current role of `../tools`, especially `emotion-lenses-tool.cjs`, and decide whether this repo should remain a maintained downstream implementation surface or be deprecated/reduced.

---

## Findings

### 1) Actual current usage/import surface

Visible workspace references show that `emotion-lenses-tool.cjs` still matters, but in a narrow way:

- `../emotion-engine/configs/*.yaml` still reference `tools/emotion-lenses-tool.cjs` as the configured tool path for Phase 2 video emotion analysis.
- `../emotion-engine/test/scripts/emotion-lenses-tool.test.js` imports `tools/emotion-lenses-tool.cjs`.
- `../emotion-engine/test/scripts/video-chunks.test.js` mocks both `tools/emotion-lenses-tool.cjs` and `../../server/lib/emotion-lenses-tool.cjs`.
- runtime failure captures in `../emotion-engine/output/.../capture.json` show the executed module path as `node_modules/tools/emotion-lenses-tool.cjs`.

Within `emotion-engine`, however, that node-module entrypoint is currently a shim:

```js
module.exports = require('../../server/lib/emotion-lenses-tool.cjs');
```

So the **canonical runtime implementation is already the local `emotion-engine/server/lib/emotion-lenses-tool.cjs` copy**, not this repo's file.

### 2) Is `../tools` still an intentionally maintained sibling runtime surface?

**Yes, but only as a lightweight package surface.** Evidence:

- dedicated package metadata (`package.json`) still publishes a real `main` entrypoint
- dedicated tests still exist and pass locally (`npm test`)
- recent repo history shows active maintenance on the tool package after initial creation:
  - `Use YAML ai.video.model and provider in emotion lenses tool`
  - `feat: add debug captureRaw support to emotion lenses tool`
  - `Forward config ai.video.params to provider options`

That said, it is **not** where current contract ownership lives anymore. The maintained surface exists, but it is no longer the authoritative implementation.

### 3) Current implementation scope

The repo is still effectively **video-only**.

Current behavior is specialized around Phase 2 chunk emotion analysis:

- persona loading from `SOUL.md` + `GOAL.md`
- optional dialogue/music/video context injection into the prompt
- lens-scored emotional state generation for a single video chunk
- JSON parsing into an emotion state object

There are no real signs of broader multi-lane extensibility beyond this one helper. The repo is a single-tool package with a single test file and no broader runtime substrate.

### 4) Drift relative to canonical `emotion-engine` implementation

The drift is now substantial enough that this repo should **not** be treated as contract-equivalent.

#### Canonical `emotion-engine` implementation now adds:

- strict structured-output parsing and validation via `parseAndValidateJsonObject`
- lane-specific schema validation via `validateEmotionStateObject`
- validator-tool loop support via `executeLocalValidatorToolLoop`
- explicit validator tool contract construction (`validate_emotion_analysis_json`)
- adapter-aware provider option construction via `buildProviderOptions`
- structured failure propagation instead of fallback success synthesis
- raw response + completion object retention in the returned result
- prompt rules that explicitly require the final JSON artifact shape and lens-valid `dominant_emotion`

#### `../tools` implementation still does the older, weaker thing:

- permissive `JSON.parse` with markdown-fence fallback parsing
- if parsing still fails, it synthesizes a default success-like state instead of surfacing a structured failure
- no validator-tool loop
- no lane-specific validator contract exports
- no structured-output error object / invalid-output failure path
- no universal success/failure envelope
- no deterministic recovery declarations
- no bounded AI recovery metadata/runtime seam
- no canonical completion object retention

### 5) Contract position

`../tools` should be treated as a **maintained downstream compatibility package**, not a contract owner.

The evidence says:

- it is still referenced and therefore not dead
- but the real architecture, tests, and recovery semantics now live upstream in `../emotion-engine`
- allowing both copies to evolve independently would create silent contract drift

---

## Recommendation

**Keep `../tools` as a maintained downstream implementation surface, while keeping all contract ownership in `../emotion-engine`.**

That means:

1. `emotion-engine/server/lib/emotion-lenses-tool.cjs` remains canonical
2. `../tools` should either:
   - re-export the canonical implementation, or
   - be updated to match it exactly enough that drift is mechanically unlikely
3. if that cannot be kept tight, then `../tools` should be explicitly reduced/deprecated instead of pretending to be equivalent

### Recommended bounded path

Prefer the smallest-maintenance option:

- convert `../tools/emotion-lenses-tool.cjs` into a thin downstream wrapper/re-export of the canonical implementation **or**
- generate/sync it from the canonical source with explicit docs saying contract ownership is upstream

A hand-maintained forked copy is the worst option here.

---

## Concrete follow-up work required for parity

If alignment is chosen, the follow-up work is:

1. **Replace or wrap the implementation**
   - make `../tools/emotion-lenses-tool.cjs` re-export or otherwise directly track `../emotion-engine/server/lib/emotion-lenses-tool.cjs`

2. **Update the tests to the canonical contract**
   - replace legacy `parseResponse`-oriented expectations with tests for:
     - strict invalid-output failure behavior
     - validator-tool contract helpers
     - canonical prompt constraints
     - returned `completion`/`rawResponse` semantics

3. **Document ownership clearly**
   - README should say this repo is a downstream package surface
   - contract/spec ownership stays in `../emotion-engine`

4. **Decide package strategy explicitly**
   - either keep publishing/using `tools` as the package entrypoint for compatibility
   - or deprecate that entrypoint and update consuming configs/imports over time

5. **Only after the above, decide bead closure**
   - this bead should stay open until either downstream alignment lands or deprecation is made explicit

---

## Bottom line

- `../tools` is **still relevant enough to audit**
- it is **not** the canonical runtime/spec surface anymore
- it has **material drift** from the current validator/recovery contract
- the right move is **downstream alignment or explicit reduction/deprecation**, not parallel ownership
