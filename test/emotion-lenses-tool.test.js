const path = require('path');
const assert = require('node:assert');
const test = require('node:test');

// Set fake API key for tests
process.env.AI_API_KEY = 'test-api-key';

// Helper to mock a module
function mockModule(modulePath, mockExports) {
  const absolutePath = require.resolve(modulePath, { paths: [__dirname] });
  if (require.cache[absolutePath]) delete require.cache[absolutePath];
  require.cache[absolutePath] = { exports: mockExports, loaded: true, id: absolutePath, filename: absolutePath };
}

// Mock AI provider
const mockAIProvider = {
  getProviderFromConfig: () => ({
    complete: async (options) => ({
      content: JSON.stringify({
        summary: 'Test chunk analysis',
        emotions: {
          patience: { score: 7, reasoning: 'Test reasoning' },
          boredom: { score: 3, reasoning: 'Test reasoning' },
          excitement: { score: 6, reasoning: 'Test reasoning' }
        },
        dominant_emotion: 'patience',
        confidence: 0.85
      }),
      usage: { input: 150, output: 100 }
    })
  }),
  getProviderFromEnv: () => {
    throw new Error('getProviderFromEnv should not be used');
  }
};

// Set up mock before requiring tool
mockModule('ai-providers/ai-provider-interface.js', mockAIProvider);

const emotionLensesTool = require('../emotion-lenses-tool.cjs');

// Fixture paths
const fixturesDir = path.join(__dirname, 'fixtures');
const soulPath = path.join(fixturesDir, 'sample-soul.md');
const goalPath = path.join(fixturesDir, 'sample-goal.md');

test('Emotion Lenses Tool', async (t) => {
  t.test('validateVariables', (tNested) => {
    tNested.test('returns valid for correct input', () => {
      const toolVariables = {
        soulPath,
        goalPath,
        variables: { lenses: ['patience', 'boredom', 'excitement'] }
      };
      const result = emotionLensesTool.validateVariables(toolVariables);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.error, undefined);
    });

    tNested.test('returns invalid when toolVariables is missing', () => {
      const result = emotionLensesTool.validateVariables(null);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error.includes('required'));
    });

    tNested.test('returns invalid when soulPath is missing', () => {
      const toolVariables = {
        goalPath,
        variables: { lenses: ['patience'] }
      };
      const result = emotionLensesTool.validateVariables(toolVariables);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error.includes('soulPath'));
    });

    tNested.test('returns invalid when goalPath is missing', () => {
      const toolVariables = {
        soulPath,
        variables: { lenses: ['patience'] }
      };
      const result = emotionLensesTool.validateVariables(toolVariables);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error.includes('goalPath'));
    });

    tNested.test('returns invalid when lenses is not an array', () => {
      const toolVariables = {
        soulPath,
        goalPath,
        variables: { lenses: 'patience' }
      };
      const result = emotionLensesTool.validateVariables(toolVariables);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error.includes('array'));
    });
  });

  t.test('buildPrompt', (tNested) => {
    tNested.test('builds prompt with all sections', () => {
      const personaConfig = {
        soul: { 'Identity': 'Test Persona', 'Core Truth': 'Test truth' },
        goal: { 'Primary Objective': 'Test goal' },
        tools: {}
      };
      const options = {
        lenses: ['patience', 'boredom'],
        videoContext: { duration: 8, frames: [] },
        dialogueContext: { segments: [] },
        musicContext: { segments: [] },
        previousState: { summary: '' }
      };
      const prompt = emotionLensesTool.buildPrompt(personaConfig, options);
      assert.ok(prompt.includes('# PERSONA'));
      assert.ok(prompt.includes('# EVALUATION GOAL'));
      assert.ok(prompt.includes('# EMOTION LENSES TO TRACK'));
      assert.ok(prompt.includes('patience'));
      assert.ok(prompt.includes('boredom'));
      assert.ok(prompt.includes('# CONTEXT'));
      assert.ok(prompt.includes('# INSTRUCTIONS'));
    });

    tNested.test('includes previous state in prompt', () => {
      const personaConfig = { soul: {}, goal: {}, tools: {} };
      const options = {
        lenses: ['patience'],
        previousState: { summary: 'Previous chunk summary' }
      };
      const prompt = emotionLensesTool.buildPrompt(personaConfig, options);
      assert.ok(prompt.includes('Previous Summary'));
      assert.ok(prompt.includes('Previous chunk summary'));
    });

    tNested.test('includes dialogue context in prompt', () => {
      const personaConfig = { soul: {}, goal: {}, tools: {} };
      const options = {
        lenses: ['patience'],
        dialogueContext: {
          segments: [{ start: 0, end: 5, speaker: 'Speaker 1', text: 'Hello' }]
        }
      };
      const prompt = emotionLensesTool.buildPrompt(personaConfig, options);
      assert.ok(prompt.includes('## Dialogue'));
      assert.ok(prompt.includes('Speaker 1'));
      assert.ok(prompt.includes('Hello'));
    });

    tNested.test('includes video context', () => {
      const personaConfig = { soul: {}, goal: {}, tools: {} };
      const options = {
        lenses: ['patience'],
        videoContext: { duration: 10, frames: [1, 2, 3] }
      };
      const prompt = emotionLensesTool.buildPrompt(personaConfig, options);
      assert.ok(prompt.includes('Duration: 10s'));
      assert.ok(prompt.includes('Frames: 3'));
    });
  });

  t.test('parseResponse', (tNested) => {
    tNested.test('parses valid JSON response', () => {
      const responseContent = JSON.stringify({
        summary: 'Test summary',
        emotions: {
          patience: { score: 8, reasoning: 'Good pacing' },
          boredom: { score: 2, reasoning: 'Very engaging' }
        },
        dominant_emotion: 'patience',
        confidence: 0.9
      });
      const state = emotionLensesTool.parseResponse(responseContent, {}, ['patience', 'boredom']);
      assert.strictEqual(state.summary, 'Test summary');
      assert.strictEqual(state.emotions.patience.score, 8);
      assert.strictEqual(state.emotions.boredom.score, 2);
      assert.strictEqual(state.dominant_emotion, 'patience');
      assert.strictEqual(state.confidence, 0.9);
    });

    tNested.test('parses JSON from markdown code block', () => {
      const responseContent = '```json\n' + JSON.stringify({
        summary: 'Test summary',
        emotions: {
          patience: { score: 7, reasoning: 'Test' }
        }
      }) + '\n```';
      const state = emotionLensesTool.parseResponse(responseContent, {}, ['patience']);
      assert.strictEqual(state.summary, 'Test summary');
      assert.strictEqual(state.emotions.patience.score, 7);
    });

    tNested.test('uses fallback for invalid JSON', () => {
      const responseContent = 'Invalid response';
      const state = emotionLensesTool.parseResponse(responseContent, {}, ['patience', 'boredom']);
      assert.strictEqual(state.summary, 'Analysis completed');
      assert.strictEqual(state.emotions.patience.score, 5);
      assert.strictEqual(state.emotions.boredom.score, 5);
    });

    tNested.test('includes previous summary in state', () => {
      const responseContent = JSON.stringify({
        summary: 'New summary',
        emotions: {}
      });
      const previousState = { summary: 'Previous summary' };
      const state = emotionLensesTool.parseResponse(responseContent, previousState, []);
      assert.strictEqual(state.previousSummary, 'Previous summary');
    });

    tNested.test('handles missing emotion fields', () => {
      const responseContent = JSON.stringify({
        summary: 'Partial response',
        emotions: {
          patience: { score: 5 }
        }
      });
      const state = emotionLensesTool.parseResponse(responseContent, {}, ['patience', 'boredom']);
      assert.strictEqual(state.emotions.patience.score, 5);
      assert.strictEqual(state.emotions.patience.reasoning, '');
      assert.strictEqual(state.emotions.boredom.score, 5);
      assert.strictEqual(state.emotions.boredom.reasoning, 'Missing from response');
    });
  });

  t.test('analyze (integration)', (tNested) => {
    tNested.test('loads persona config and calls AI provider', async () => {
      const input = {
        toolVariables: {
          soulPath,
          goalPath,
          variables: { lenses: ['patience', 'boredom', 'excitement'] }
        },
        videoContext: {
          chunkPath: '/tmp/test.mp4',
          chunkIndex: 0,
          startTime: 0,
          endTime: 8,
          duration: 8
        },
        dialogueContext: { segments: [] },
        musicContext: { segments: [] },
        previousState: { summary: '', emotions: {} },
        config: { ai: { provider: 'openrouter', video: { model: 'yaml-video-model' } } }
      };

      const result = await emotionLensesTool.analyze(input);

      assert.ok('prompt' in result);
      assert.ok('state' in result);
      assert.ok('usage' in result);
      assert.strictEqual(result.state.summary, 'Test chunk analysis');
      assert.strictEqual(result.state.emotions.patience.score, 7);
      assert.strictEqual(result.usage.input, 150);
      assert.strictEqual(result.usage.output, 100);
    });

    tNested.test('prompt includes persona content', async () => {
      const input = {
        toolVariables: {
          soulPath,
          goalPath,
          variables: { lenses: ['patience'] }
        },
        videoContext: { duration: 5 },
        dialogueContext: { segments: [] },
        musicContext: { segments: [] },
        previousState: { summary: '' },
        config: { ai: { provider: 'openrouter', video: { model: 'yaml-video-model' } } }
      };

      const result = await emotionLensesTool.analyze(input);
      // The persona should include the Test Persona name from sample-soul.md
      assert.ok(result.prompt.includes('Test Persona'));
      assert.ok(result.prompt.includes('Core Truth'));
    });

    tNested.test('throws error when toolVariables is invalid', async () => {
      const input = { toolVariables: null };
      await assert.rejects(emotionLensesTool.analyze(input), /toolVariables is required/);
    });

    tNested.test('throws error when soul file not found', async () => {
      const input = {
        toolVariables: {
          soulPath: '/nonexistent/SOUL.md',
          goalPath,
          variables: { lenses: ['patience'] }
        },
        videoContext: { duration: 5 },
        dialogueContext: { segments: [] },
        musicContext: { segments: [] },
        previousState: { summary: '' },
        config: { ai: { provider: 'openrouter', video: { model: 'yaml-video-model' } } }
      };
      await assert.rejects(emotionLensesTool.analyze(input), /Failed to load persona configuration/);
    });

    tNested.test('preserves previous summary across chunks', async () => {
      const prevInput = {
        toolVariables: {
          soulPath,
          goalPath,
          variables: { lenses: ['patience'] }
        },
        videoContext: { duration: 5 },
        dialogueContext: { segments: [] },
        musicContext: { segments: [] },
        previousState: { summary: 'Previous chunk' },
        config: { ai: { provider: 'openrouter', video: { model: 'yaml-video-model' } } }
      };
      const result = await emotionLensesTool.analyze(prevInput);
      assert.strictEqual(result.state.previousSummary, 'Previous chunk');
    });
  });
});
