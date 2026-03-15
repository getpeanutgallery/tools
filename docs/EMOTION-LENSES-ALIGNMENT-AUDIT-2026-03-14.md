# Emotion lenses tool alignment note — 2026-03-14

**Bead:** `ee-cwi.4`  
**Status:** Implemented in `../tools`  
**Canonical contract owner:** `../tools`

---

## Outcome

The earlier audit found that `emotion-engine/server/lib/emotion-lenses-tool.cjs` had become the hidden runtime owner of the emotion-lenses contract while `../tools/emotion-lenses-tool.cjs` drifted into an older, weaker implementation.

That drift has now been corrected in favor of the intended polyrepo ownership model:

- `../tools/emotion-lenses-tool.cjs` is again the canonical shared implementation.
- The tools-owned implementation now carries the strict structured-output behavior relied on by `emotion-engine`.
- The tools package now exports the validator-tool-loop helpers and metadata expected for a clean cutover back to sibling-repo ownership.

## Implemented behavior now owned by `tools`

- strict JSON parsing/validation for emotion-analysis responses
- schema validation for one required emotions entry per configured lens
- `validate_emotion_analysis_json` validator tool contract
- local validator-tool-loop execution with malformed-envelope handling and tool-call limits
- structured `invalid_output` retryable failures instead of fallback synthesized success
- adapter-aware provider option forwarding from `config.ai.video.params`
- returned `rawResponse` and `completion` metadata for downstream capture/debugging

## What `emotion-engine` can now consume from `tools`

`emotion-engine` can now consume `tools/emotion-lenses-tool.cjs` as the sibling-owned implementation surface for:

- `analyze(...)`
- `buildBasePromptFromInput(...)`
- `buildEmotionAnalysisValidatorToolContract(...)`
- `executeEmotionAnalysisValidatorTool(...)`
- `executeEmotionAnalysisToolLoop(...)`
- `EMOTION_ANALYSIS_TOOL_NAME`

## 2026-03-15 closure addendum

That follow-up has now landed.

Current live state:

- `emotion-engine` imports `../../../../tools/emotion-lenses-tool.cjs` directly from `server/scripts/process/video-chunks.cjs`
- the old engine-local canonical file (`emotion-engine/server/lib/emotion-lenses-tool.cjs`) is gone
- configs continue to point at the sibling `../tools/emotion-lenses-tool.cjs` path

## 2026-03-15 prompt-contract consistency addendum

A follow-up sibling-repo wording sweep aligned the remaining tools-owned prompt surface to the current cross-repo contract standard:

- `emotion-lenses-tool.cjs` now follows Option B for the closed string field `dominant_emotion` by keeping the JSON example concrete and adding an explicit nearby allowed-values note.
- `lib/local-validator-tool-loop.cjs` was rechecked and already matched the agreed validator-tool wording standard, including the canonical minimal envelope instruction, the shared wrapper-key prohibition sentence, and the `valid=true` acceptance wording, so it was intentionally left unchanged.
- `README.md` and `test/emotion-lenses-tool.test.js` were updated to document and verify the same wording standard.

This audit should now be read as the pre-fix rationale for `ee-cwi.4`, plus the sibling-repo consistency note for the 2026-03-15 wording sweep.
