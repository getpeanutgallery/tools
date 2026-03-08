# Tools

This package contains tools for the emotion-engine pipeline.

## emotion-lenses-tool

Analyzes video chunks for emotional content using AI and persona configuration.

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
  previousState: { summary: '' }
});
```

### API

- `validateVariables(toolVariables)` - Validate configuration
- `buildPrompt(personaConfig, options)` - Build analysis prompt
- `parseResponse(responseContent, previousState, lenses)` - Parse AI response
- `analyze(input)` - Run complete analysis

## Testing

```bash
npm test
```
