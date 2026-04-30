const path = require('path');
const assert = require('node:assert');
const test = require('node:test');

process.env.AI_API_KEY = 'test-api-key';

function mockModule(modulePath, mockExports) {
  const absolutePath = require.resolve(modulePath, { paths: [__dirname] });
  if (require.cache[absolutePath]) delete require.cache[absolutePath];
  require.cache[absolutePath] = { exports: mockExports, loaded: true, id: absolutePath, filename: absolutePath };
}

let lastCompleteArgs = null;
const mockAIProvider = {
  getProviderFromConfig: () => ({
    complete: async (args) => {
      lastCompleteArgs = args;
      return {
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
      };
    }
  }),
  getProviderFromEnv: () => {
    throw new Error('getProviderFromEnv should not be used');
  }
};

mockModule('ai-providers/ai-provider-interface.js', mockAIProvider);

const emotionLensesTool = require('../emotion-lenses-tool.cjs');

const fixturesDir = path.join(__dirname, 'fixtures');
const soulPath = path.join(fixturesDir, 'sample-soul.md');
const goalPath = path.join(fixturesDir, 'sample-goal.md');

test('Emotion Lenses Tool', async (t) => {
  t.beforeEach(() => {
    lastCompleteArgs = null;
  });

  await t.test('validateVariables', async (tNested) => {
    await tNested.test('returns valid for correct input', () => {
      const toolVariables = {
        soulPath,
        goalPath,
        variables: { lenses: ['patience', 'boredom', 'excitement'] }
      };
      const result = emotionLensesTool.validateVariables(toolVariables);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.error, undefined);
    });

    await tNested.test('returns invalid when toolVariables is missing', () => {
      const result = emotionLensesTool.validateVariables(null);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error.includes('required'));
    });

    await tNested.test('returns invalid when soulPath is missing', () => {
      const toolVariables = {
        goalPath,
        variables: { lenses: ['patience'] }
      };
      const result = emotionLensesTool.validateVariables(toolVariables);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error.includes('soulPath'));
    });

    await tNested.test('returns invalid when goalPath is missing', () => {
      const toolVariables = {
        soulPath,
        variables: { lenses: ['patience'] }
      };
      const result = emotionLensesTool.validateVariables(toolVariables);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error.includes('goalPath'));
    });

    await tNested.test('returns invalid when lenses is not an array', () => {
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

  await t.test('prompt and validator helpers', async (tNested) => {
    await tNested.test('builds strict prompt with all sections', () => {
      const personaConfig = {
        soul: { Identity: 'Test Persona', 'Core Truth': 'Test truth' },
        goal: { 'Primary Objective': 'Test goal' },
        tools: {}
      };
      const options = {
        lenses: ['patience', 'boredom'],
        videoContext: {
          chunkPath: __filename,
          mimeType: 'video/mp4',
          transferStrategy: 'base64',
          duration: 8,
          startTime: 0,
          endTime: 8
        },
        dialogueContext: { segments: [{ start: 0, end: 5, speaker: 'Speaker 1', text: 'Hello' }] },
        musicContext: {
          summary: 'Trailer-wide music stays tense and cinematic.',
          segments: [{
            start: 0,
            end: 5,
            type: 'music',
            description: 'Aggressive percussion hits under the opening threat.',
            mood: 'tense',
            intensity: 6
          }]
        },
        previousState: { summary: 'Previous chunk summary' }
      };
      const prompt = emotionLensesTool.buildPrompt(personaConfig, options);
      assert.ok(prompt.includes('# PERSONA'));
      assert.ok(prompt.includes('# EVALUATION GOAL'));
      assert.ok(prompt.includes('# EMOTION LENSES TO TRACK'));
      assert.ok(prompt.includes('# CONTEXT'));
      assert.ok(prompt.includes('# INSTRUCTIONS'));
      assert.ok(prompt.includes('Ground your judgment in the attached video chunk first'));
      assert.ok(prompt.includes('Attached video chunk: video/mp4 (base64)'));
      assert.ok(prompt.includes('Return JSON only.'));
      assert.ok(prompt.includes('Allowed values for dominant_emotion: patience | boredom.'));
      assert.ok(prompt.includes('dominant_emotion must match one of the configured lens names'));
      assert.ok(prompt.includes('Previous chunk summary'));
      assert.ok(prompt.includes('Speaker 1'));
      assert.ok(prompt.includes('Trailer-wide context: Trailer-wide music stays tense and cinematic.'));
      assert.ok(prompt.includes('- Relevant global support entries:'));
      assert.ok(prompt.includes('detail: Aggressive percussion hits under the opening threat.'));
      assert.ok(prompt.includes('cite chunk-local visual evidence from the attached video when available'));
      assert.ok(prompt.includes('Do not use dialogue, lyrics, music, or previous-summary continuity as a substitute for chunk-local visual grounding.'));
      assert.ok(prompt.includes('tense'));
    });

    await tNested.test('clips overlapping dialogue and music ranges to the active chunk window in the prompt', () => {
      const personaConfig = {
        soul: { Identity: 'Test Persona' },
        goal: { 'Primary Objective': 'Test goal' },
        tools: {}
      };
      const prompt = emotionLensesTool.buildPrompt(personaConfig, {
        lenses: ['patience', 'boredom'],
        videoContext: {
          chunkPath: __filename,
          mimeType: 'video/mp4',
          transferStrategy: 'base64',
          duration: 5,
          startTime: 50,
          endTime: 55
        },
        dialogueContext: { segments: [{ start: 48, end: 52.5, speaker: 'Speaker 6', text: 'Need a sitrep.' }] },
        musicContext: {
          summary: 'The trailer stays high-intensity and tense overall.',
          segments: [{
            start: 0,
            end: 140.042449,
            type: 'music',
            description: 'Sustained tense orchestral pulse with pounding percussion.',
            mood: 'tense',
            intensity: 8
          }]
        },
        previousState: { summary: '' }
      });

      assert.ok(prompt.includes('- 48.0s-52.5s: Speaker 6: Need a sitrep.'));
      assert.ok(prompt.includes('Trailer-wide context: The trailer stays high-intensity and tense overall.'));
      assert.ok(prompt.includes('- 0.0s-140.0s: music, detail: Sustained tense orchestral pulse with pounding percussion., mood: tense, intensity: 8'));
      assert.ok(prompt.includes('- Chunk window: 50.0s-55.0s'));
    });

    await tNested.test('does not truncate trailer-wide or active-chunk music text', () => {
      const personaConfig = {
        soul: { Identity: 'Test Persona' },
        goal: { 'Primary Objective': 'Test goal' },
        tools: {}
      };
      const longSummary = 'Trailer-wide arc: the cue starts with a hush, swells through dread, pivots into bruising percussion, then keeps layering anxious strings without ever fully releasing the pressure before the end card lands.';
      const longDescription = 'Detailed cue: low brass pulses creep underneath a brittle riser, then syncopated percussion stomps in while scraped strings and distorted impacts keep ratcheting the tension higher instead of resolving cleanly.';
      const prompt = emotionLensesTool.buildPrompt(personaConfig, {
        lenses: ['patience'],
        videoContext: {
          chunkPath: __filename,
          mimeType: 'video/mp4',
          transferStrategy: 'base64',
          duration: 5,
          startTime: 10,
          endTime: 15
        },
        dialogueContext: { segments: [] },
        musicContext: {
          summary: longSummary,
          segments: [{
            start: 10,
            end: 15,
            type: 'music',
            description: longDescription,
            mood: 'tense',
            intensity: 9
          }]
        },
        previousState: { summary: '' }
      });

      assert.ok(prompt.includes(`Trailer-wide context: ${longSummary}`));
      assert.ok(prompt.includes(`detail: ${longDescription}`));
      assert.ok(!prompt.includes('…'));
    });

    await tNested.test('buildBasePromptFromInput loads persona content', () => {
      const prompt = emotionLensesTool.buildBasePromptFromInput({
        toolVariables: {
          soulPath,
          goalPath,
          variables: { lenses: ['patience', 'boredom'] }
        },
        videoContext: { chunkPath: __filename, mimeType: 'video/mp4', transferStrategy: 'base64', duration: 8 },
        dialogueContext: { segments: [] },
        musicContext: { segments: [] },
        previousState: { summary: '' }
      });

      assert.ok(prompt.includes('Test Persona'));
      assert.ok(prompt.includes('Core Truth'));
      assert.ok(prompt.includes('Primary Objective'));
    });

    await tNested.test('builds a lane-specific validator contract', () => {
      const contract = emotionLensesTool.buildEmotionAnalysisValidatorToolContract({
        lenses: ['patience', 'boredom']
      });

      assert.strictEqual(contract.name, 'validate_emotion_analysis_json');
      assert.strictEqual(contract.argumentKey, 'emotionAnalysis');
      assert.strictEqual(contract.canonicalEnvelope.tool, 'validate_emotion_analysis_json');
      assert.ok(contract.canonicalEnvelope.emotionAnalysis.emotions.patience);
      assert.ok(contract.canonicalEnvelope.emotionAnalysis.emotions.boredom);
    });

    await tNested.test('validates a correct candidate artifact', () => {
      const result = emotionLensesTool.executeEmotionAnalysisValidatorTool({
        emotionAnalysis: {
          summary: 'Steady and focused.',
          emotions: {
            patience: { score: 8, reasoning: 'Measured delivery.' },
            boredom: { score: 2, reasoning: 'Momentum stays intact.' }
          },
          dominant_emotion: 'patience',
          confidence: 0.9
        }
      }, {
        lenses: ['patience', 'boredom']
      });

      assert.ok(result.valid);
      assert.strictEqual(result.normalizedValue.summary, 'Steady and focused.');
    });

    await tNested.test('rejects missing required lens entries', () => {
      const result = emotionLensesTool.executeEmotionAnalysisValidatorTool({
        emotionAnalysis: {
          summary: 'Incomplete payload.',
          emotions: {
            patience: { score: 8, reasoning: 'Present.' }
          },
          dominant_emotion: 'patience',
          confidence: 0.9
        }
      }, {
        lenses: ['patience', 'boredom']
      });

      assert.ok(!result.valid);
      assert.ok(result.summary.includes('boredom'));
    });
  });

  await t.test('parseResponse', async (tNested) => {
    await tNested.test('parses valid JSON response', () => {
      const responseContent = JSON.stringify({
        summary: 'Test summary',
        emotions: {
          patience: { score: 8, reasoning: 'Good pacing' },
          boredom: { score: 2, reasoning: 'Very engaging' }
        },
        dominant_emotion: 'patience',
        confidence: 0.9
      });
      const state = emotionLensesTool.parseResponse(responseContent, { summary: 'Previous summary' }, ['patience', 'boredom']);
      assert.strictEqual(state.summary, 'Test summary');
      assert.strictEqual(state.emotions.patience.score, 8);
      assert.strictEqual(state.emotions.boredom.score, 2);
      assert.strictEqual(state.dominant_emotion, 'patience');
      assert.strictEqual(state.confidence, 0.9);
      assert.strictEqual(state.previousSummary, 'Previous summary');
    });

    await tNested.test('throws structured error for invalid JSON', () => {
      assert.throws(
        () => emotionLensesTool.parseResponse('Invalid response', {}, ['patience']),
        /Response was not valid JSON/
      );
    });

    await tNested.test('throws structured error for invalid schema', () => {
      assert.throws(
        () => emotionLensesTool.parseResponse(JSON.stringify({ summary: 'oops', emotions: {}, dominant_emotion: 'wrong', confidence: 2 }), {}, ['patience']),
        /Emotion JSON validation failed/
      );
    });
  });

  await t.test('analyze', async (tNested) => {
    await tNested.test('loads persona config and returns structured result', async () => {
      const input = {
        toolVariables: {
          soulPath,
          goalPath,
          variables: { lenses: ['patience', 'boredom', 'excitement'] }
        },
        videoContext: {
          chunkPath: __filename,
          chunkIndex: 0,
          startTime: 0,
          endTime: 8,
          duration: 8,
          mimeType: 'video/mp4',
          transferStrategy: 'base64'
        },
        dialogueContext: { segments: [] },
        musicContext: { segments: [] },
        previousState: { summary: '', emotions: {} },
        provider: mockAIProvider.getProviderFromConfig(),
        config: { ai: { provider: 'openrouter', video: { model: 'yaml-video-model' } } }
      };

      const result = await emotionLensesTool.analyze(input);

      assert.ok('prompt' in result);
      assert.ok('state' in result);
      assert.ok('usage' in result);
      assert.ok('rawResponse' in result);
      assert.ok('completion' in result);
      assert.strictEqual(result.state.summary, 'Test chunk analysis');
      assert.strictEqual(result.state.emotions.patience.score, 7);
      assert.strictEqual(result.usage.input, 150);
      assert.strictEqual(result.usage.output, 100);
      assert.strictEqual(lastCompleteArgs.model, 'yaml-video-model');
      assert.strictEqual(lastCompleteArgs.attachments.length, 1);
      assert.strictEqual(lastCompleteArgs.attachments[0].type, 'video');
      assert.strictEqual(lastCompleteArgs.attachments[0].mimeType, 'video/mp4');
      assert.ok(typeof lastCompleteArgs.attachments[0].data === 'string');
      assert.ok(lastCompleteArgs.attachments[0].data.length > 0);
    });

    await tNested.test('forwards config.ai.video.params into provider options', async () => {
      const input = {
        toolVariables: {
          soulPath,
          goalPath,
          variables: { lenses: ['patience'] }
        },
        videoContext: { chunkPath: __filename, mimeType: 'video/mp4', transferStrategy: 'base64', duration: 8 },
        dialogueContext: { segments: [] },
        musicContext: { segments: [] },
        previousState: { summary: '', emotions: {} },
        provider: mockAIProvider.getProviderFromConfig(),
        config: {
          ai: {
            provider: 'openrouter',
            video: {
              model: 'yaml-video-model',
              params: {
                temperature: 0.95,
                maxTokens: 222,
                topP: 0.2
              }
            }
          }
        }
      };

      await emotionLensesTool.analyze(input);

      assert.ok(lastCompleteArgs);
      assert.strictEqual(lastCompleteArgs.options.temperature, 0.95);
      assert.strictEqual(lastCompleteArgs.options.maxTokens, 222);
      assert.strictEqual(lastCompleteArgs.options.topP, 0.2);
    });

    await tNested.test('throws error when toolVariables is invalid', async () => {
      const input = { toolVariables: null };
      await assert.rejects(emotionLensesTool.analyze(input), /toolVariables is required/);
    });

    await tNested.test('throws error when soul file not found', async () => {
      const input = {
        toolVariables: {
          soulPath: '/nonexistent/SOUL.md',
          goalPath,
          variables: { lenses: ['patience'] }
        },
        videoContext: { chunkPath: __filename, mimeType: 'video/mp4', transferStrategy: 'base64', duration: 5 },
        dialogueContext: { segments: [] },
        musicContext: { segments: [] },
        previousState: { summary: '' },
        config: { ai: { provider: 'openrouter', video: { model: 'yaml-video-model' } } }
      };
      await assert.rejects(emotionLensesTool.analyze(input), /failed to load persona configuration/);
    });

    await tNested.test('hard-fails when provider is not injected explicitly', async () => {
      await assert.rejects(
        emotionLensesTool.analyze({
          toolVariables: {
            soulPath,
            goalPath,
            variables: { lenses: ['patience'] }
          },
          videoContext: { chunkPath: __filename, mimeType: 'video/mp4', transferStrategy: 'base64', duration: 5 },
          dialogueContext: { segments: [] },
          musicContext: { segments: [] },
          previousState: { summary: '' },
          config: { ai: { provider: 'openrouter', video: { model: 'yaml-video-model' } } },
          apiKey: 'override-key'
        }),
        /provider must be injected explicitly/
      );
    });

    await tNested.test('throws structured error for invalid provider output', async () => {
      const provider = {
        complete: async () => ({
          content: JSON.stringify({
            summary: 'Broken',
            emotions: { patience: { score: 20, reasoning: 'Too high' } },
            dominant_emotion: 'panic',
            confidence: 5
          }),
          usage: { input: 1, output: 1 }
        })
      };

      await assert.rejects(
        emotionLensesTool.analyze({
          toolVariables: {
            soulPath,
            goalPath,
            variables: { lenses: ['patience'] }
          },
          videoContext: { chunkPath: __filename, mimeType: 'video/mp4', transferStrategy: 'base64', duration: 5 },
          dialogueContext: { segments: [] },
          musicContext: { segments: [] },
          previousState: { summary: '' },
          provider,
          apiKey: 'override-key',
          config: { ai: { provider: 'openrouter', video: { model: 'yaml-video-model' } } }
        }),
        /Emotion JSON validation failed/
      );
    });
  });

  await t.test('executeEmotionAnalysisToolLoop', async (tNested) => {
    await tNested.test('short-circuits immediately on first validator acceptance and preserves completion metadata', async () => {
      const responses = [
        JSON.stringify({
          tool: 'validate_emotion_analysis_json',
          emotionAnalysis: {
            summary: 'First draft',
            emotions: {
              patience: { score: 8, reasoning: 'Calm pacing' },
              boredom: { score: 2, reasoning: 'Engaging enough' }
            },
            dominant_emotion: 'patience',
            confidence: 0.9
          }
        })
      ];

      let lastToolLoopArgs = null;
      let providerCalls = 0;
      const emittedEvents = [];
      const provider = {
        complete: async (args) => {
          providerCalls += 1;
          lastToolLoopArgs = args;
          return { content: responses.shift(), usage: { input: 10, output: 5 } };
        }
      };

      const result = await emotionLensesTool.executeEmotionAnalysisToolLoop({
        provider,
        adapter: { name: 'openrouter', model: 'yaml-video-model' },
        apiKey: 'override-key',
        toolVariables: {
          soulPath,
          goalPath,
          variables: { lenses: ['patience', 'boredom'] }
        },
        videoContext: {
          chunkPath: __filename,
          mimeType: 'video/mp4',
          transferStrategy: 'base64',
          duration: 8
        },
        basePrompt: 'Base prompt',
        toolLoopConfig: { maxTurns: 3, maxValidatorCalls: 3 },
        events: { emit: (event) => emittedEvents.push(event) },
        ctx: { attempt: 2, attemptInTarget: 1, targetIndex: 0 },
        config: { ai: { video: { model: 'yaml-video-model' } } }
      });

      assert.strictEqual(providerCalls, 1);
      assert.deepStrictEqual(result.parsed, {
        summary: 'First draft',
        emotions: {
          patience: { score: 8, reasoning: 'Calm pacing' },
          boredom: { score: 2, reasoning: 'Engaging enough' }
        },
        dominant_emotion: 'patience',
        confidence: 0.9
      });
      assert.deepStrictEqual(result.toolLoop.finalArtifact, result.parsed);
      assert.strictEqual(result.requestPrompt.mode, 'tool_loop');
      assert.strictEqual(result.requestPrompt.repairSummary, null);
      assert.strictEqual(result.toolLoop.turns, 1);
      assert.strictEqual(result.toolLoop.validatorCalls, 1);
      assert.deepStrictEqual(result.toolLoop.history.map((entry) => entry.kind), [
        'model_output',
        'validator_acceptance'
      ]);
      assert.strictEqual(emittedEvents.length, 1);
      assert.deepStrictEqual(emittedEvents[0], {
        kind: 'tool.loop.complete',
        phase: 'phase2-process',
        script: 'video-chunks',
        domain: 'video',
        attempt: 2,
        attemptInTarget: 1,
        targetIndex: 0,
        validatorCalls: 1,
        turns: 1,
        toolName: 'validate_emotion_analysis_json',
        provider: 'openrouter',
        model: 'yaml-video-model'
      });
      assert.strictEqual(lastToolLoopArgs.attachments.length, 1);
      assert.strictEqual(lastToolLoopArgs.attachments[0].type, 'video');
      assert.strictEqual(lastToolLoopArgs.attachments[0].mimeType, 'video/mp4');
      assert.ok(typeof lastToolLoopArgs.attachments[0].data === 'string');
      assert.ok(lastToolLoopArgs.attachments[0].data.length > 0);
    });

    await tNested.test('preserves invalid repair behavior before acceptance', async () => {
      const responses = [
        JSON.stringify({
          tool: 'validate_emotion_analysis_json',
          emotionAnalysis: {
            summary: 'Broken draft',
            emotions: {
              patience: { score: 8, reasoning: 'Calm pacing' }
            },
            dominant_emotion: 'patience',
            confidence: 0.9
          }
        }),
        JSON.stringify({
          tool: 'validate_emotion_analysis_json',
          emotionAnalysis: {
            summary: 'Repaired draft',
            emotions: {
              patience: { score: 8, reasoning: 'Calm pacing' },
              boredom: { score: 2, reasoning: 'Engaging enough' }
            },
            dominant_emotion: 'patience',
            confidence: 0.9
          }
        })
      ];

      let providerCalls = 0;
      const provider = {
        complete: async () => {
          providerCalls += 1;
          return { content: responses.shift(), usage: { input: 10, output: 5 } };
        }
      };

      const result = await emotionLensesTool.executeEmotionAnalysisToolLoop({
        provider,
        adapter: { name: 'openrouter', model: 'yaml-video-model' },
        apiKey: 'override-key',
        toolVariables: {
          soulPath,
          goalPath,
          variables: { lenses: ['patience', 'boredom'] }
        },
        videoContext: {
          chunkPath: __filename,
          mimeType: 'video/mp4',
          transferStrategy: 'base64',
          duration: 8
        },
        basePrompt: 'Base prompt',
        toolLoopConfig: { maxTurns: 3, maxValidatorCalls: 3 },
        config: { ai: { video: { model: 'yaml-video-model' } } }
      });

      assert.strictEqual(providerCalls, 2);
      assert.strictEqual(result.parsed.summary, 'Repaired draft');
      assert.strictEqual(result.toolLoop.turns, 2);
      assert.strictEqual(result.toolLoop.validatorCalls, 2);
      assert.deepStrictEqual(result.toolLoop.history.map((entry) => entry.kind), [
        'model_output',
        'validator_rejection',
        'model_output',
        'validator_acceptance'
      ]);
    });
  });
});
