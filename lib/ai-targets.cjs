const NORMALIZED_THINKING_LEVELS = new Set(['off', 'low', 'medium', 'high']);
const DEFAULT_DEVELOPMENT_MAX_TOKENS = 25000;
const DEFAULT_DEVELOPMENT_THINKING_LEVEL = 'low';

function normalizeThinkingLevel(level) {
  if (typeof level !== 'string') return null;
  const normalized = level.trim().toLowerCase();
  return NORMALIZED_THINKING_LEVELS.has(normalized) ? normalized : null;
}

function normalizeAdapterParamsForProvider(adapter = {}) {
  const rawParams = adapter?.params;
  const params = (rawParams && typeof rawParams === 'object' && !Array.isArray(rawParams))
    ? { ...rawParams }
    : {};

  if (params.max_tokens === undefined && params.maxTokens === undefined) {
    params.maxTokens = DEFAULT_DEVELOPMENT_MAX_TOKENS;
  }

  if (params.thinking === undefined && params.reasoning === undefined) {
    params.thinking = { level: DEFAULT_DEVELOPMENT_THINKING_LEVEL };
  }

  if (params.max_tokens !== undefined && params.maxTokens === undefined) {
    params.maxTokens = params.max_tokens;
  }
  delete params.max_tokens;

  const thinking = params.thinking;
  delete params.thinking;

  const normalizedThinkingLevel = normalizeThinkingLevel(thinking?.level);
  if (normalizedThinkingLevel) {
    const adapterName = typeof adapter?.name === 'string' ? adapter.name.trim().toLowerCase() : '';
    if (adapterName === 'openrouter') {
      const existingReasoning = params.reasoning && typeof params.reasoning === 'object' && !Array.isArray(params.reasoning)
        ? params.reasoning
        : {};

      params.reasoning = {
        ...existingReasoning,
        effort: normalizedThinkingLevel === 'off' ? 'none' : normalizedThinkingLevel,
        enabled: normalizedThinkingLevel !== 'off'
      };
    }
  }

  return params;
}

function buildProviderOptions({ adapter, defaults = {} } = {}) {
  return {
    ...(defaults && typeof defaults === 'object' ? defaults : {}),
    ...normalizeAdapterParamsForProvider(adapter)
  };
}

function createRetryableError(message, extra = {}) {
  const err = new Error(message);
  err.aiTargets = {
    classification: 'retryable',
    ...extra
  };
  return err;
}

module.exports = {
  normalizeThinkingLevel,
  normalizeAdapterParamsForProvider,
  buildProviderOptions,
  createRetryableError,
  DEFAULT_DEVELOPMENT_MAX_TOKENS,
  DEFAULT_DEVELOPMENT_THINKING_LEVEL
};
