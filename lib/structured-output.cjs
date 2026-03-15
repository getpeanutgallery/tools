const { parseJsonObjectInput } = require('./json-validator.cjs');

function compactString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function pushError(errors, path, code, message) {
  errors.push({ path, code, message });
}

function validateNonEmptyString(value, path, label, errors) {
  const normalized = compactString(value);
  if (!normalized) {
    pushError(errors, path, 'required_string', `${label} must be a non-empty string.`);
    return null;
  }
  return normalized;
}

function validateFiniteNumber(value, path, label, errors, { min = null, max = null } = {}) {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    pushError(errors, path, 'required_number', `${label} must be a finite number.`);
    return null;
  }

  if (min !== null && value < min) {
    pushError(errors, path, 'out_of_range', `${label} must be >= ${min}.`);
    return null;
  }

  if (max !== null && value > max) {
    pushError(errors, path, 'out_of_range', `${label} must be <= ${max}.`);
    return null;
  }

  return value;
}

function summarizeValidationErrors(prefix, errors = []) {
  if (!Array.isArray(errors) || errors.length === 0) return null;
  const parts = errors.slice(0, 6).map((error) => `${error.path}: ${error.message}`);
  const suffix = errors.length > 6 ? ` (+${errors.length - 6} more)` : '';
  return `${prefix} ${parts.join(' | ')}${suffix} Return corrected JSON only.`;
}

function validateEmotionStateObject(input, lenses = []) {
  const errors = [];

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      ok: false,
      value: null,
      errors: [{ path: '$', code: 'invalid_type', message: 'Emotion analysis output must be a JSON object.' }],
      summary: 'Emotion analysis output must be a JSON object. Return corrected JSON only.',
      meta: { stage: 'validation' }
    };
  }

  const summary = validateNonEmptyString(input.summary, '$.summary', 'summary', errors);
  const dominantEmotion = validateNonEmptyString(input.dominant_emotion, '$.dominant_emotion', 'dominant_emotion', errors);
  const confidence = validateFiniteNumber(input.confidence, '$.confidence', 'confidence', errors, { min: 0, max: 1 });

  const emotionsInput = input.emotions;
  if (!emotionsInput || typeof emotionsInput !== 'object' || Array.isArray(emotionsInput)) {
    pushError(errors, '$.emotions', 'invalid_type', 'emotions must be an object keyed by lens.');
  }

  const emotions = {};
  for (const lens of lenses) {
    const lensPath = `$.emotions.${lens}`;
    const value = emotionsInput?.[lens];
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      pushError(errors, lensPath, 'invalid_type', `emotion entry for lens "${lens}" must be an object.`);
      continue;
    }

    emotions[lens] = {
      score: validateFiniteNumber(value.score, `${lensPath}.score`, `${lens} score`, errors, { min: 1, max: 10 }),
      reasoning: validateNonEmptyString(value.reasoning, `${lensPath}.reasoning`, `${lens} reasoning`, errors)
    };
  }

  if (dominantEmotion && Array.isArray(lenses) && lenses.length > 0 && !lenses.includes(dominantEmotion)) {
    pushError(errors, '$.dominant_emotion', 'invalid_enum', `dominant_emotion must be one of: ${lenses.join(', ')}.`);
  }

  return {
    ok: errors.length === 0,
    value: errors.length === 0 ? {
      summary,
      emotions,
      dominant_emotion: dominantEmotion,
      confidence
    } : null,
    errors,
    summary: summarizeValidationErrors('Emotion JSON validation failed.', errors),
    meta: { stage: 'validation' }
  };
}

function parseAndValidateJsonObject(input, validate) {
  const parsed = parseJsonObjectInput(input);
  if (!parsed.ok) return parsed;

  const validated = validate(parsed.value);
  if (!validated.ok) {
    return {
      ...validated,
      meta: {
        ...parsed.meta,
        ...validated.meta,
        raw: parsed.meta?.raw ?? null,
        extracted: parsed.meta?.extracted ?? null,
        repairApplied: parsed.meta?.repairApplied ?? false,
        sourceType: parsed.meta?.sourceType || 'unknown'
      }
    };
  }

  return {
    ok: true,
    value: validated.value,
    errors: [],
    summary: null,
    meta: {
      ...parsed.meta,
      stage: 'validation'
    }
  };
}

module.exports = {
  compactString,
  summarizeValidationErrors,
  parseAndValidateJsonObject,
  validateEmotionStateObject
};
