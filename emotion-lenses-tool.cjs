const fs = require('fs');
const path = require('path');
const { buildProviderOptions } = require('./lib/ai-targets.cjs');
const { executeLocalValidatorToolLoop } = require('./lib/local-validator-tool-loop.cjs');
const { parseAndValidateJsonObject, validateEmotionStateObject } = require('./lib/structured-output.cjs');

const EMOTION_ANALYSIS_TOOL_NAME = 'validate_emotion_analysis_json';

const personaLoader = {
  loadSoul(soulPath) {
    if (!soulPath) return null;

    let resolvedPath = soulPath;
    if (!path.isAbsolute(soulPath)) {
      resolvedPath = path.resolve(__dirname, soulPath);
    }

    if (!fs.existsSync(resolvedPath)) return null;
    return this.parseMarkdown(fs.readFileSync(resolvedPath, 'utf8'));
  },

  loadGoal(goalPath) {
    if (!goalPath) return null;

    let resolvedPath = goalPath;
    if (!path.isAbsolute(goalPath)) {
      resolvedPath = path.resolve(__dirname, goalPath);
    }

    if (fs.existsSync(resolvedPath)) {
      return this.parseMarkdown(fs.readFileSync(resolvedPath, 'utf8'));
    }

    const nodeModulesPath = path.resolve(__dirname, 'node_modules', 'goals', goalPath);
    if (!fs.existsSync(nodeModulesPath)) return null;
    return this.parseMarkdown(fs.readFileSync(nodeModulesPath, 'utf8'));
  },

  loadPersonaConfig(soulPath, goalPath) {
    const soul = this.loadSoul(soulPath);
    const goal = this.loadGoal(goalPath);
    if (!soul || !goal) return null;
    return { soul, goal, tools: null };
  },

  parseMarkdown(markdown) {
    const sections = {};
    const lines = markdown.split('\n');
    let currentSection = 'header';
    let currentContent = [];

    for (const line of lines) {
      if (line.startsWith('## ')) {
        if (currentContent.length > 0) {
          sections[currentSection] = currentContent.join('\n').trim();
        }
        currentSection = line.replace('## ', '').trim();
        currentContent = [];
      } else {
        currentContent.push(line);
      }
    }

    if (currentContent.length > 0) {
      sections[currentSection] = currentContent.join('\n').trim();
    }

    return sections;
  }
};

function validateVariables(toolVariables) {
  if (!toolVariables) {
    return { valid: false, error: 'toolVariables is required' };
  }

  if (!toolVariables.soulPath || !toolVariables.goalPath) {
    return { valid: false, error: 'toolVariables.soulPath and toolVariables.goalPath are required' };
  }

  if (!toolVariables.variables || !Array.isArray(toolVariables.variables.lenses)) {
    return { valid: false, error: 'toolVariables.variables.lenses must be an array' };
  }

  return { valid: true };
}

function detectVideoMimeType(videoContext = {}) {
  if (typeof videoContext?.mimeType === 'string' && videoContext.mimeType.trim().length > 0) {
    return videoContext.mimeType.trim();
  }

  const candidatePath = videoContext?.chunkPath || videoContext?.url || '';
  const ext = path.extname(candidatePath).toLowerCase();

  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mkv') return 'video/x-matroska';
  return 'video/mp4';
}

function getInlineVideoBase64(videoContext = {}) {
  if (typeof videoContext?.chunkBase64 === 'string' && videoContext.chunkBase64.length > 0) {
    return videoContext.chunkBase64;
  }
  if (typeof videoContext?.base64 === 'string' && videoContext.base64.length > 0) {
    return videoContext.base64;
  }
  if (typeof videoContext?.data === 'string' && videoContext.data.length > 0) {
    return videoContext.data;
  }
  if (typeof videoContext?.chunkPath === 'string' && videoContext.chunkPath.length > 0 && fs.existsSync(videoContext.chunkPath)) {
    return fs.readFileSync(videoContext.chunkPath).toString('base64');
  }
  return null;
}

function buildVideoAttachments(videoContext) {
  if (!videoContext || typeof videoContext !== 'object') return [];

  const mimeType = detectVideoMimeType(videoContext);
  const base64Data = getInlineVideoBase64(videoContext);

  if (base64Data) {
    return [{
      type: 'video',
      data: base64Data,
      mimeType
    }];
  }

  if (typeof videoContext.url === 'string' && videoContext.url.length > 0) {
    return [{
      type: 'video',
      url: videoContext.url,
      mimeType
    }];
  }

  if (typeof videoContext.chunkPath === 'string' && videoContext.chunkPath.length > 0) {
    return [{
      type: 'video',
      path: videoContext.chunkPath,
      mimeType
    }];
  }

  return [];
}

function getPromptWindow(videoContext = {}) {
  const startTime = Number(videoContext?.startTime);
  const endTime = Number(videoContext?.endTime);

  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    return null;
  }

  return {
    startTime,
    endTime
  };
}

function formatSegmentRangeForPrompt(segment = {}, videoContext = {}) {
  const originalStart = Number(segment?.start);
  const originalEnd = Number(segment?.end);

  if (!Number.isFinite(originalStart) || !Number.isFinite(originalEnd)) {
    return `${segment?.start}s-${segment?.end}s`;
  }

  const window = getPromptWindow(videoContext);
  if (!window) {
    return `${originalStart.toFixed(1)}s-${originalEnd.toFixed(1)}s`;
  }

  const clippedStart = Math.max(window.startTime, originalStart);
  const clippedEnd = Math.min(window.endTime, originalEnd);

  return `${clippedStart.toFixed(1)}s-${clippedEnd.toFixed(1)}s`;
}

function normalizePromptText(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

function formatMusicSegmentForPrompt(segment = {}, videoContext = {}) {
  const details = [segment?.type || 'music'];

  if (segment?.description) {
    details.push(`detail: ${normalizePromptText(segment.description)}`);
  }
  if (segment?.mood) {
    details.push(`mood: ${segment.mood}`);
  }
  if (segment?.intensity !== undefined && segment?.intensity !== null && segment?.intensity !== '') {
    details.push(`intensity: ${segment.intensity}`);
  }

  return `- ${formatSegmentRangeForPrompt(segment, videoContext)}: ${details.join(', ')}`;
}

function buildPrompt(personaConfig, options) {
  const { lenses, videoContext, dialogueContext, musicContext, previousState } = options;
  const videoAttachments = buildVideoAttachments(videoContext);

  let prompt = '';
  prompt += '# PERSONA\n\n';

  if (personaConfig.soul) {
    prompt += Object.entries(personaConfig.soul).map(([k, v]) => `## ${k}\n${v}`).join('\n\n') + '\n\n';
  }
  if (personaConfig.goal) {
    prompt += Object.entries(personaConfig.goal).map(([k, v]) => `## ${k}\n${v}`).join('\n\n') + '\n\n';
  }
  if (personaConfig.tools) {
    prompt += Object.entries(personaConfig.tools).map(([k, v]) => `## ${k}\n${v}`).join('\n\n') + '\n\n';
  }

  prompt += '# EVALUATION GOAL\n\n';
  prompt += `Analyze the emotional content of this video chunk using the following lenses: ${lenses.join(', ')}.\n\n`;

  prompt += '# EMOTION LENSES TO TRACK\n\n';
  lenses.forEach((lens) => {
    prompt += `## ${lens}\n- Score (1-10): How intense is this emotion?\n- Reasoning: Brief explanation\n\n`;
  });

  prompt += '# CONTEXT\n\n';
  if (previousState && previousState.summary) {
    prompt += `## Previous Summary (continuity only — do not let this override fresh evidence)\n${previousState.summary}\n\n`;
  }
  if (dialogueContext && dialogueContext.segments && dialogueContext.segments.length > 0) {
    prompt += '## Dialogue\n';
    dialogueContext.segments.forEach((seg) => {
      prompt += `- ${formatSegmentRangeForPrompt(seg, videoContext)}: ${seg.speaker || 'Speaker'}: ${seg.text}\n`;
    });
    prompt += '\n';
  }
  if ((musicContext && Array.isArray(musicContext.segments) && musicContext.segments.length > 0)
    || (typeof musicContext?.summary === 'string' && musicContext.summary.trim().length > 0)) {
    prompt += '## Music\n';
    if (typeof musicContext?.summary === 'string' && musicContext.summary.trim().length > 0) {
      prompt += `- Trailer-wide context: ${normalizePromptText(musicContext.summary)}\n`;
    }
    if (Array.isArray(musicContext?.segments) && musicContext.segments.length > 0) {
      prompt += '- Active chunk cues:\n';
      musicContext.segments.forEach((seg) => {
        prompt += `  ${formatMusicSegmentForPrompt(seg, videoContext)}\n`;
      });
    }
    prompt += '\n';
  }
  if (videoContext) {
    prompt += `## Video\n- Duration: ${videoContext.duration}s\n`;
    if (typeof videoContext.startTime === 'number' && typeof videoContext.endTime === 'number') {
      prompt += `- Chunk window: ${videoContext.startTime.toFixed(1)}s-${videoContext.endTime.toFixed(1)}s\n`;
    }
    if (videoAttachments.length > 0) {
      prompt += `- Attached video chunk: ${videoAttachments[0].mimeType || detectVideoMimeType(videoContext)} (${videoContext.transferStrategy || 'base64'})\n`;
    } else {
      prompt += '- Attached video chunk: unavailable\n';
    }
    prompt += '\n';
  }

  prompt += '# INSTRUCTIONS\n\n';
  prompt += 'Ground your judgment in the attached video chunk first, then use dialogue and music as supporting context.\n';
  prompt += 'Treat previous summary as continuity only. Do not let it override what is visible in this chunk.\n';
  prompt += 'If the visuals are ambiguous, limited, or absent, say so plainly and do not invent unseen actions or scenes.\n';
  prompt += 'Return JSON only. Do not use markdown fences, commentary, or any wrapper outside a single JSON object.\n';
  prompt += 'The final JSON object must contain exactly the emotion-analysis artifact for this chunk.\n';
  prompt += 'Required shape:\n';
  prompt += '{\n';
  prompt += '  "summary": "Brief summary of this chunk (1-2 sentences)",\n';
  prompt += '  "emotions": {\n';
  lenses.forEach((lens, index) => {
    prompt += `    "${lens}": { "score": <1-10>, "reasoning": "explanation" }${index < lenses.length - 1 ? ',' : ''}\n`;
  });
  prompt += '  },\n';
  prompt += '  "dominant_emotion": "patience",\n';
  prompt += '  "confidence": <0.0-1.0>\n';
  prompt += '}\n';
  prompt += `Allowed values for dominant_emotion: ${lenses.join(' | ')}.\n`;
  prompt += 'dominant_emotion must match one of the configured lens names.\n';

  return prompt;
}

function buildContract({ name, description, argumentKey, candidateDescription, example }) {
  return {
    name,
    argumentKey,
    description,
    canonicalEnvelope: {
      tool: name,
      [argumentKey]: example
    },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: [argumentKey],
      properties: {
        [argumentKey]: {
          type: 'object',
          description: candidateDescription
        }
      }
    }
  };
}

function normalizeObjectArgument(args, argumentKey) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return {
      ok: false,
      errors: [{ path: '$', code: 'invalid_tool_arguments', message: `Tool arguments must be a JSON object containing ${argumentKey}.` }]
    };
  }

  const value = args[argumentKey];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      ok: false,
      errors: [{ path: `$.${argumentKey}`, code: 'invalid_tool_arguments', message: `${argumentKey} must be a JSON object.` }]
    };
  }

  return {
    ok: true,
    value: { [argumentKey]: value }
  };
}

function buildToolResult({ validation, toolName, invalidArgsSummary }) {
  if (!validation) {
    return {
      ok: false,
      valid: false,
      toolName,
      summary: invalidArgsSummary,
      errors: [],
      normalizedValue: null
    };
  }

  return {
    ok: validation.ok,
    valid: validation.ok,
    toolName,
    summary: validation.ok
      ? 'Emotion analysis JSON is valid. Return the final JSON artifact.'
      : validation.summary,
    errors: validation.errors,
    normalizedValue: validation.ok ? validation.value : null
  };
}

function buildEmotionAnalysisValidatorToolContract({ lenses = [] } = {}) {
  const exampleEmotions = {};
  for (const lens of lenses) {
    exampleEmotions[lens] = { score: 6, reasoning: `${lens} evidence from the chunk.` };
  }

  return buildContract({
    name: EMOTION_ANALYSIS_TOOL_NAME,
    argumentKey: 'emotionAnalysis',
    description: 'Validate a Phase 2 video chunk emotion-analysis JSON candidate against the required local schema before final submission.',
    candidateDescription: 'Candidate emotion-analysis JSON with summary, dominant_emotion, confidence, and one emotions entry per configured lens.',
    example: {
      summary: 'The speaker stays calm and measured while tension slowly rises.',
      emotions: exampleEmotions,
      dominant_emotion: lenses[0] || 'patience',
      confidence: 0.82
    }
  });
}

function executeEmotionAnalysisValidatorTool(args, { lenses = [] } = {}) {
  const normalizedArgs = normalizeObjectArgument(args, 'emotionAnalysis');
  if (!normalizedArgs.ok) {
    return {
      ok: false,
      valid: false,
      toolName: EMOTION_ANALYSIS_TOOL_NAME,
      summary: 'Tool arguments were invalid. Provide {"emotionAnalysis": {...}}.',
      errors: normalizedArgs.errors,
      normalizedValue: null
    };
  }

  const validation = validateEmotionStateObject(normalizedArgs.value.emotionAnalysis, lenses);
  return buildToolResult({
    validation,
    toolName: EMOTION_ANALYSIS_TOOL_NAME,
    invalidArgsSummary: 'Tool arguments were invalid. Provide {"emotionAnalysis": {...}}.'
  });
}

function loadLocalAiProviderInterface() {
  return require('ai-providers/ai-provider-interface.js');
}

function getActiveProvider({ provider, config, allowConfigProviderFallback = false }) {
  if (provider && typeof provider.complete === 'function') {
    return provider;
  }

  if (!allowConfigProviderFallback) {
    throw new Error('EmotionLensesTool: provider must be injected explicitly; refusing fallback to tools-local ai-providers install');
  }

  const aiProvider = loadLocalAiProviderInterface();
  return typeof aiProvider.getProviderFromConfig === 'function'
    ? aiProvider.getProviderFromConfig(config)
    : aiProvider.loadProvider(config?.ai?.provider || 'openrouter');
}

function getResolvedModel({ adapter, config }) {
  return adapter?.model || config?.ai?.video?.model;
}

function getCompletionDefaults() {
  return {
    temperature: 0.3
  };
}

function buildBasePromptFromInput(input) {
  const { toolVariables, videoContext, dialogueContext, musicContext, previousState } = input;
  const personaConfig = personaLoader.loadPersonaConfig(toolVariables.soulPath, toolVariables.goalPath);
  if (!personaConfig) {
    throw new Error('EmotionLensesTool: failed to load persona configuration');
  }

  return buildPrompt(personaConfig, {
    lenses: toolVariables.variables.lenses,
    videoContext,
    dialogueContext,
    musicContext,
    previousState
  });
}

function parseResponse(responseContent, previousState, lenses) {
  const parsed = parseAndValidateJsonObject(responseContent, (value) => validateEmotionStateObject(value, lenses));
  if (!parsed.ok) {
    const error = new Error(parsed.summary || 'EmotionLensesTool: invalid JSON response');
    error.structuredOutput = parsed;
    error.rawResponse = typeof responseContent === 'string' ? responseContent : null;
    throw error;
  }

  return {
    ...parsed.value,
    previousSummary: previousState?.summary || ''
  };
}

async function analyze(input) {
  const { toolVariables, videoContext, dialogueContext, musicContext, previousState, config, provider, adapter, apiKey } = input;

  const validation = validateVariables(toolVariables);
  if (!validation.valid) {
    throw new Error(`EmotionLensesTool: ${validation.error}`);
  }

  const prompt = buildBasePromptFromInput({
    toolVariables,
    videoContext,
    dialogueContext,
    musicContext,
    previousState
  });

  const activeProvider = getActiveProvider({
    provider,
    config,
    allowConfigProviderFallback: input?.allowConfigProviderFallback === true
  });

  const resolvedApiKey = apiKey || process.env.AI_API_KEY;
  if (!resolvedApiKey) {
    throw new Error('EmotionLensesTool: AI_API_KEY is required');
  }

  const model = getResolvedModel({ adapter, config });
  if (!model) {
    throw new Error('EmotionLensesTool: config.ai.video.model is required');
  }

  const completion = await activeProvider.complete({
    prompt,
    model,
    apiKey: resolvedApiKey,
    attachments: buildVideoAttachments(videoContext),
    options: buildProviderOptions({
      adapter: adapter || { name: config?.ai?.provider || 'openrouter', params: config?.ai?.video?.params },
      defaults: getCompletionDefaults()
    })
  });

  const parsed = parseAndValidateJsonObject(completion?.content, (value) => validateEmotionStateObject(value, toolVariables.variables.lenses));
  if (!parsed.ok) {
    const error = new Error(parsed.summary || 'EmotionLensesTool: invalid JSON response');
    error.structuredOutput = parsed;
    error.rawResponse = completion?.content || null;
    error.completion = completion || null;
    error.prompt = prompt;
    throw error;
  }

  return {
    prompt,
    rawResponse: completion?.content || null,
    state: {
      ...parsed.value,
      previousSummary: previousState?.summary || ''
    },
    usage: completion?.usage || null,
    completion
  };
}

async function executeEmotionAnalysisToolLoop({
  provider,
  adapter,
  toolVariables,
  videoContext,
  basePrompt,
  toolLoopConfig,
  promptRef,
  events,
  ctx,
  apiKey,
  config
}) {
  const validation = validateVariables(toolVariables);
  if (!validation.valid) {
    throw new Error(`EmotionLensesTool: ${validation.error}`);
  }

  const resolvedApiKey = apiKey || process.env.AI_API_KEY;
  if (!resolvedApiKey) {
    throw new Error('EmotionLensesTool: AI_API_KEY is required');
  }

  const model = getResolvedModel({ adapter, config });
  if (!model) {
    throw new Error('EmotionLensesTool: config.ai.video.model is required');
  }

  const toolContract = buildEmotionAnalysisValidatorToolContract({
    lenses: toolVariables?.variables?.lenses || []
  });

  return executeLocalValidatorToolLoop({
    provider,
    adapter,
    basePrompt,
    toolContract,
    toolLoopConfig,
    promptRef,
    events,
    ctx,
    phaseKey: 'phase2-process',
    scriptId: 'video-chunks',
    domain: 'video',
    artifactLabel: 'emotion analysis',
    finalArtifactDescription: 'The final artifact must be the emotion-analysis JSON object for this video chunk.',
    finalArtifactRules: [
      'Include summary, emotions, dominant_emotion, and confidence.',
      'Provide exactly one emotions entry per configured lens.',
      'Each emotions.<lens>.score must be between 1 and 10.',
      'dominant_emotion must match one of the configured lens names.',
      'confidence must be between 0 and 1.'
    ],
    callProvider: ({ prompt }) => provider.complete({
      prompt,
      model,
      apiKey: resolvedApiKey,
      attachments: buildVideoAttachments(videoContext),
      options: buildProviderOptions({
        adapter,
        defaults: getCompletionDefaults()
      })
    }),
    executeValidatorTool: (args) => executeEmotionAnalysisValidatorTool(args, {
      lenses: toolVariables?.variables?.lenses || []
    }),
    normalizeValidatedValue: (value) => JSON.stringify(value)
  });
}

module.exports = {
  EMOTION_ANALYSIS_TOOL_NAME,
  validateVariables,
  buildPrompt,
  buildBasePromptFromInput,
  buildVideoAttachments,
  buildEmotionAnalysisValidatorToolContract,
  executeEmotionAnalysisValidatorTool,
  executeEmotionAnalysisToolLoop,
  parseResponse,
  analyze
};
