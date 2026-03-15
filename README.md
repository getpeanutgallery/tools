# Tools

This package contains shared tools for the peanut-gallery emotion-engine pipeline.

`emotion-lenses-tool.cjs` is the canonical shared Phase 2 emotion-analysis implementation. `emotion-engine` should consume this package surface directly rather than keeping a hidden divergent runtime owner in-repo.

## emotion-lenses-tool

Analyzes video chunks for emotional content using AI and persona configuration, with the same strict structured-output and validator-tool-loop contract expected by `emotion-engine`.

### Current contract surface

- strict JSON-only prompt contract for the final emotion-analysis artifact
- Option B enum guidance for closed string fields: keep example JSON concrete and document nearby allowed values explicitly (for example `Allowed values for dominant_emotion: <lens1> | <lens2> | ...`)
- lane-specific validator tool contract via `validate_emotion_analysis_json`
- local validator-tool loop via `executeEmotionAnalysisToolLoop(...)`, using the canonical minimal tool-call envelope and the shared `valid=true` acceptance wording
- structured invalid-output failures instead of synthesized fallback success
- provider option forwarding from `config.ai.video.params`
- returned `rawResponse` and `completion` metadata for downstream capture/debugging

### Usage

```javascript
const emotionLensesTool = require('tools/emotion-lenses-tool.cjs');

const result = await emotionLensesTool.analyze({
  toolVariables: {
    soulPath: '/path/to/SOUL.md',
    goalPath: '/path/to/GOAL.md',
    variables: {
      lenses: ['patience', 'boredom', 'excitement']
    }
  },
  videoContext: { duration: 8, frames: [] },
  dialogueContext: { segments: [] },
  musicContext: { segments: [] },
  previousState: { summary: '' },
  config: {
    ai: {
      provider: 'openrouter',
      video: { model: 'openrouter/google/gemini-3.1-pro-preview' }
    }
  }
});
```

### API

- `EMOTION_ANALYSIS_TOOL_NAME`
- `validateVariables(toolVariables)`
- `buildPrompt(personaConfig, options)`
- `buildBasePromptFromInput(input)`
- `buildEmotionAnalysisValidatorToolContract({ lenses })`
- `executeEmotionAnalysisValidatorTool(args, { lenses })`
- `executeEmotionAnalysisToolLoop({ ... })`
- `parseResponse(responseContent, previousState, lenses)`
- `analyze(input)`

## Testing

```bash
npm test
```
