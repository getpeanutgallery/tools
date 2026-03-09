#!/usr/bin/env node
/**
 * Emotion Lenses Tool
 * 
 * Analyzes video chunks for emotional content using AI and persona configuration.
 * Self-contained implementation with embedded persona loader.
 */

const fs = require('fs');
const path = require('path');

/**
 * Embedded persona loader - no external dependencies
 */
const personaLoader = {
  /**
   * Load SOUL.md content
   */
  loadSoul(soulPath) {
    if (!soulPath) {
      console.error('❌ soulPath is required');
      return null;
    }
    
    let resolvedPath = soulPath;
    if (!path.isAbsolute(soulPath)) {
      resolvedPath = path.resolve(__dirname, '..', soulPath);
    }
    
    if (!fs.existsSync(resolvedPath)) {
      console.error(`❌ SOUL.md not found at path: ${resolvedPath}`);
      return null;
    }
    
    const content = fs.readFileSync(resolvedPath, 'utf8');
    return this.parseMarkdown(content);
  },

  /**
   * Load GOAL.md content
   */
  loadGoal(goalPath) {
    if (!goalPath) {
      console.error('❌ goalPath is required');
      return null;
    }
    
    let resolvedPath = goalPath;
    if (!path.isAbsolute(goalPath)) {
      resolvedPath = path.resolve(__dirname, '..', goalPath);
    }
    
    if (fs.existsSync(resolvedPath)) {
      const content = fs.readFileSync(resolvedPath, 'utf8');
      return this.parseMarkdown(content);
    }
    
    // Try node_modules/goals
    const nodeModulesPath = path.resolve(__dirname, '..', 'node_modules', 'goals', goalPath);
    if (fs.existsSync(nodeModulesPath)) {
      const content = fs.readFileSync(nodeModulesPath, 'utf8');
      return this.parseMarkdown(content);
    }
    
    console.error(`❌ GOAL.md not found at path: ${goalPath}`);
    return null;
  },

  /**
   * Load complete persona config
   */
  loadPersonaConfig(soulPath, goalPath) {
    const soul = this.loadSoul(soulPath);
    const goal = this.loadGoal(goalPath);
    
    if (!soul || !goal) {
      return null;
    }
    
    return { soul, goal, tools: null };
  },

  /**
   * Parse markdown into sections (keyed by heading)
   */
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

/**
 * Get AI provider from YAML config (source of truth)
 */
async function getAIProvider(config) {
  try {
    const aiProvider = require('ai-providers/ai-provider-interface.js');
    const provider = typeof aiProvider.getProviderFromConfig === 'function'
      ? aiProvider.getProviderFromConfig(config)
      : aiProvider.loadProvider(config?.ai?.provider || 'openrouter');
    const apiKey = process.env.AI_API_KEY;
    if (!apiKey) {
      throw new Error('AI_API_KEY is required');
    }
    return { provider, apiKey };
  } catch (e) {
    throw new Error(`AI provider unavailable: ${e.message}`);
  }
}

/**
 * Validate tool variables
 * @param {Object} toolVariables - The tool variables to validate
 * @returns {Object} { valid: boolean, error?: string }
 */
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

/**
 * Build prompt for emotion analysis
 * @param {Object} personaConfig - Persona configuration (soul, goal, tools)
 * @param {Object} options - Analysis options (lenses, videoContext, dialogueContext, musicContext, previousState)
 * @returns {string} The constructed prompt
 */
function buildPrompt(personaConfig, options) {
  const { lenses, videoContext, dialogueContext, musicContext, previousState } = options;

  let prompt = '';

  // Persona section
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

  // Evaluation goal
  prompt += '# EVALUATION GOAL\n\n';
  prompt += `Analyze the emotional content of this video chunk using the following lenses: ${lenses.join(', ')}.\n\n`;

  // Emotion lenses
  prompt += '# EMOTION LENSES TO TRACK\n\n';
  lenses.forEach(lens => {
    prompt += `## ${lens}\n- Score (1-10): How intense is this emotion?\n- Reasoning: Brief explanation\n\n`;
  });

  // Context
  prompt += '# CONTEXT\n\n';
  if (previousState && previousState.summary) {
    prompt += `## Previous Summary\n${previousState.summary}\n\n`;
  }
  if (dialogueContext && dialogueContext.segments && dialogueContext.segments.length > 0) {
    prompt += '## Dialogue\n';
    dialogueContext.segments.forEach(seg => {
      prompt += `- ${seg.start.toFixed(1)}s-${seg.end.toFixed(1)}s: ${seg.speaker || 'Speaker'}: ${seg.text}\n`;
    });
    prompt += '\n';
  }
  if (musicContext && musicContext.segments && musicContext.segments.length > 0) {
    prompt += '## Music\n';
    musicContext.segments.forEach(seg => {
      prompt += `- ${seg.start.toFixed(1)}s-${seg.end.toFixed(1)}s: ${seg.type}${seg.mood ? `, mood: ${seg.mood}` : ''}${seg.intensity ? `, intensity: ${seg.intensity}` : ''}\n`;
    });
    prompt += '\n';
  }
  if (videoContext) {
    prompt += `## Video\n- Duration: ${videoContext.duration}s\n`;
    if (videoContext.frames) {
      prompt += `- Frames: ${videoContext.frames.length} frame(s) extracted\n`;
    }
    prompt += '\n';
  }

  // Instructions
  prompt += '# INSTRUCTIONS\n\n';
  prompt += 'Respond with a JSON object (ONLY the JSON, no markdown) containing:\n';
  prompt += '{\n';
  prompt += '  "summary": "Brief summary of this chunk (1-2 sentences)",\n';
  prompt += '  "emotions": {\n';
  lenses.forEach((lens, i) => {
    prompt += `    "${lens}": { "score": <1-10>, "reasoning": "explanation" }${i < lenses.length - 1 ? ',' : ''}\n`;
  });
  prompt += '  },\n';
  prompt += '  "dominant_emotion": "the most prominent emotion lens",\n';
  prompt += '  "confidence": <0.0-1.0>\n';
  prompt += '}\n';

  return prompt;
}

/**
 * Parse AI response into state object
 * @param {string} responseContent - Raw AI response
 * @param {Object} previousState - Previous chunk state (for previousSummary)
 * @param {string[]} lenses - Configured lenses
 * @returns {Object} Parsed state
 */
function parseResponse(responseContent, previousState, lenses) {
  let data;
  try {
    data = JSON.parse(responseContent.trim());
  } catch (e) {
    const jsonMatch = responseContent.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        data = JSON.parse(jsonMatch[1].trim());
      } catch (e2) {
        data = null;
      }
    }
  }

  if (!data) {
    const emotions = {};
    lenses.forEach(lens => {
      emotions[lens] = { score: 5, reasoning: 'Default - could not parse response' };
    });
    return {
      summary: 'Analysis completed',
      emotions,
      dominant_emotion: lenses[0] || 'unknown',
      confidence: 0.5,
      previousSummary: previousState?.summary || ''
    };
  }

  const emotions = {};
  lenses.forEach(lens => {
    if (data.emotions && data.emotions[lens]) {
      emotions[lens] = {
        score: data.emotions[lens].score || 5,
        reasoning: data.emotions[lens].reasoning || ''
      };
    } else {
      emotions[lens] = { score: 5, reasoning: 'Missing from response' };
    }
  });

  return {
    summary: data.summary || 'No summary provided',
    emotions,
    dominant_emotion: data.dominant_emotion || lenses[0],
    confidence: typeof data.confidence === 'number' ? data.confidence : 0.7,
    previousSummary: previousState?.summary || ''
  };
}

/**
 * Analyze a video chunk
 * @param {Object} input - Input object with toolVariables, videoContext, dialogueContext, musicContext, previousState
 * @returns {Promise<Object>} Analysis result with prompt, state, usage
 */
async function analyze(input) {
  const { toolVariables, videoContext, dialogueContext, musicContext, previousState, config } = input;

  // Validate
  const validation = validateVariables(toolVariables);
  if (!validation.valid) {
    throw new Error(`EmotionLensesTool: ${validation.error}`);
  }

  // Load persona config using embedded loader
  const personaConfig = personaLoader.loadPersonaConfig(toolVariables.soulPath, toolVariables.goalPath);
  if (!personaConfig) {
    throw new Error('Failed to load persona configuration');
  }

  // Build prompt
  const prompt = buildPrompt(personaConfig, {
    lenses: toolVariables.variables.lenses,
    videoContext,
    dialogueContext,
    musicContext,
    previousState
  });

  // Get AI provider and model from YAML config
  const { provider, apiKey } = await getAIProvider(config);
  const model = config?.ai?.video?.model;
  if (!model) {
    throw new Error('EmotionLensesTool: config.ai.video.model is required');
  }

  // Legacy compatibility: tool_variables.variables.model must match YAML model if present
  const legacyModel = toolVariables?.variables?.model;
  if (legacyModel && legacyModel !== model) {
    throw new Error(
      `EmotionLensesTool: tool_variables.variables.model (${legacyModel}) does not match config.ai.video.model (${model})`
    );
  }

  const adapterParams = config?.ai?.video?.params;
  const forwardedParams = adapterParams
    && typeof adapterParams === 'object'
    && adapterParams !== null
    && !Array.isArray(adapterParams)
    ? adapterParams
    : {};

  // Call AI
  const response = await provider.complete({
    prompt,
    model,
    apiKey,
    options: {
      temperature: 0.3,
      maxTokens: 1024,
      ...forwardedParams
    }
  });

  // Parse response
  const state = parseResponse(response.content, previousState, toolVariables.variables.lenses);

  const result = {
    prompt,
    state,
    usage: response.usage
  };

  if (config?.debug?.captureRaw) {
    result.rawResponse = response.content;
  }

  return result;
}

module.exports = {
  validateVariables,
  buildPrompt,
  parseResponse,
  analyze
};
