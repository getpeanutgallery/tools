const { parseJsonObjectInput } = require('./json-validator.cjs');
const { createRetryableError } = require('./ai-targets.cjs');

function defaultNormalizeForComparison(value) {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
}

function compactString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function looksLikeToolEnvelopeAttempt(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;

  const markers = [
    input.tool,
    input.toolName,
    input.type,
    input.kind,
    input.arguments,
    input.args,
    input.input,
    input.name
  ];

  return markers.some((value) => value !== undefined);
}

function summarizeMalformedEnvelope(input, { toolName, argKey }) {
  const actualTool = compactString(input?.tool || input?.toolName || input?.name || '');

  if (actualTool && actualTool !== toolName) {
    return `Malformed ${toolName} tool call envelope. Expected {"tool":"${toolName}","${argKey}":{...}} but received tool "${actualTool}".`;
  }

  return `Malformed ${toolName} tool call envelope. Expected exactly {"tool":"${toolName}","${argKey}":{...}}.`;
}

function parseValidatorToolCallEnvelope(input, { toolName, argKey }) {
  const parsed = parseJsonObjectInput(input);
  if (!parsed.ok) {
    return {
      ok: false,
      kind: 'parse_error',
      errors: parsed.errors,
      summary: parsed.summary,
      meta: parsed.meta
    };
  }

  const value = parsed.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      ok: false,
      kind: 'not_tool_call',
      errors: [{ path: '$', code: 'not_tool_call_envelope', message: `Object was not a ${toolName} tool call envelope.` }],
      summary: `Object was not a ${toolName} tool call envelope.`,
      meta: parsed.meta
    };
  }

  const tool = compactString(value.tool);
  const candidate = value[argKey];
  const extraKeys = Object.keys(value).filter((key) => key !== 'tool' && key !== argKey);

  if (tool === toolName && candidate && typeof candidate === 'object' && !Array.isArray(candidate) && extraKeys.length === 0) {
    return {
      ok: true,
      kind: 'canonical_tool_call',
      value: {
        tool: toolName,
        [argKey]: candidate,
        arguments: { [argKey]: candidate }
      },
      meta: parsed.meta
    };
  }

  if (looksLikeToolEnvelopeAttempt(value)) {
    const errors = [];

    if (tool !== toolName) {
      errors.push({ path: '$.tool', code: 'invalid_tool_name', message: `tool must equal "${toolName}".` });
    }

    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      errors.push({ path: `$.${argKey}`, code: 'invalid_tool_arguments', message: `${argKey} must be a JSON object.` });
    }

    if (extraKeys.length > 0) {
      errors.push({
        path: '$',
        code: 'unexpected_tool_envelope_keys',
        message: `Unexpected tool envelope keys: ${extraKeys.join(', ')}.`
      });
    }

    return {
      ok: false,
      kind: 'malformed_tool_call',
      errors,
      summary: summarizeMalformedEnvelope(value, { toolName, argKey }),
      meta: parsed.meta,
      envelope: value
    };
  }

  return {
    ok: false,
    kind: 'not_tool_call',
    errors: [{ path: '$', code: 'not_tool_call_envelope', message: `Object was not a ${toolName} tool call envelope.` }],
    summary: `Object was not a ${toolName} tool call envelope.`,
    meta: parsed.meta
  };
}

function buildLocalValidatorToolPrompt({
  basePrompt,
  toolContract,
  history,
  remainingTurns,
  remainingValidatorCalls,
  artifactLabel,
  finalArtifactDescription,
  finalArtifactRules = []
}) {
  return [
    basePrompt,
    '',
    'LOCAL TOOL LOOP:',
    'You have access to one local validation tool. You may respond with exactly one JSON object in one of these forms:',
    '1) Canonical tool call envelope:',
    JSON.stringify(toolContract.canonicalEnvelope, null, 2),
    `2) Final ${artifactLabel} JSON matching the schema above.`,
    '',
    'Acceptance rules:',
    `- The final ${artifactLabel} JSON is accepted only after ${toolContract.name} returns {"valid": true}.`,
    `- If you call the tool, use exactly this minimal envelope: ${JSON.stringify(toolContract.canonicalEnvelope)}.`,
    '- Do not add type/toolName/arguments/args/input wrappers around the tool call.',
    `- If the validator reports problems, revise and either call the tool again or return a revised ${artifactLabel} JSON candidate.`,
    `- After the validator returns valid=true, return ONLY the final ${artifactLabel} JSON object with no wrapper.`,
    '- Do not emit markdown, prose, or multiple objects.',
    ...(finalArtifactDescription ? ['', finalArtifactDescription] : []),
    ...(Array.isArray(finalArtifactRules) && finalArtifactRules.length > 0
      ? ['', 'Final artifact reminders:', ...finalArtifactRules.map((rule) => `- ${rule}`)]
      : []),
    '',
    'Tool contract:',
    JSON.stringify(toolContract, null, 2),
    '',
    'Current turn budget:',
    JSON.stringify({ remainingTurns, remainingValidatorCalls }, null, 2),
    '',
    'Conversation state:',
    JSON.stringify(history, null, 2)
  ].join('\n');
}

async function executeLocalValidatorToolLoop({
  provider,
  adapter,
  basePrompt,
  toolContract,
  toolLoopConfig,
  promptRef,
  events,
  ctx,
  phaseKey,
  scriptId,
  domain,
  artifactLabel,
  finalArtifactDescription,
  finalArtifactRules,
  callProvider,
  executeValidatorTool,
  normalizeValidatedValue = defaultNormalizeForComparison,
  autoValidationKind = 'tool_result_auto_validation',
  finalArtifactAcceptedKind = 'final_artifact_revalidation'
}) {
  const history = [];
  let successfulValidatedValue = null;
  let validatorCalls = 0;
  let finalCompletion = null;
  let finalPromptMode = 'tool_loop';

  for (let turn = 1; turn <= toolLoopConfig.maxTurns; turn += 1) {
    const remainingTurns = toolLoopConfig.maxTurns - turn + 1;
    const remainingValidatorCalls = Math.max(toolLoopConfig.maxValidatorCalls - validatorCalls, 0);
    const prompt = buildLocalValidatorToolPrompt({
      basePrompt,
      toolContract,
      history,
      remainingTurns,
      remainingValidatorCalls,
      artifactLabel,
      finalArtifactDescription,
      finalArtifactRules
    });

    const promptMode = turn === 1 ? 'tool_loop' : 'tool_loop_followup';
    finalPromptMode = promptMode;

    const completion = await callProvider({ provider, adapter, prompt, turn, promptMode });
    finalCompletion = completion;
    const rawContent = completion?.content;

    history.push({ role: 'assistant', turn, kind: 'model_output', raw: rawContent });

    const parsedObject = parseJsonObjectInput(rawContent);
    if (!parsedObject.ok) {
      throw createRetryableError(`invalid_output: ${artifactLabel} response was not valid JSON`, {
        group: parsedObject.meta?.stage || 'parse',
        raw: parsedObject.meta?.raw || rawContent || null,
        extracted: parsedObject.meta?.extracted || null,
        parseError: parsedObject.meta?.parseError || null,
        validationErrors: parsedObject.errors,
        validationSummary: parsedObject.summary,
        completion,
        promptMode,
        promptRef: promptRef ? { sha256: promptRef.sha256, file: promptRef.file } : null,
        toolLoop: {
          toolName: toolContract.name,
          maxTurns: toolLoopConfig.maxTurns,
          maxValidatorCalls: toolLoopConfig.maxValidatorCalls,
          turn,
          validatorCalls,
          history
        }
      });
    }

    const toolCall = parseValidatorToolCallEnvelope(parsedObject.value, {
      toolName: toolContract.name,
      argKey: toolContract.argumentKey
    });

    if (toolCall.ok) {
      if (validatorCalls >= toolLoopConfig.maxValidatorCalls) {
        throw createRetryableError(`invalid_output: exceeded ${toolContract.name} tool-call limit`, {
          group: 'tool_loop',
          raw: rawContent || null,
          extracted: parsedObject.meta?.extracted || null,
          validationErrors: [{ path: '$', code: 'tool_call_limit_exceeded', message: `Exceeded ${toolContract.name} tool-call limit.` }],
          validationSummary: `Exceeded ${toolContract.name} tool-call limit. Return a final validated ${artifactLabel} JSON.`,
          completion,
          promptMode,
          promptRef: promptRef ? { sha256: promptRef.sha256, file: promptRef.file } : null,
          toolLoop: {
            toolName: toolContract.name,
            maxTurns: toolLoopConfig.maxTurns,
            maxValidatorCalls: toolLoopConfig.maxValidatorCalls,
            turn,
            validatorCalls,
            history
          }
        });
      }

      validatorCalls += 1;
      const toolResult = executeValidatorTool(toolCall.value.arguments);

      history.push({
        role: 'tool',
        turn,
        kind: toolResult.valid ? 'validator_acceptance' : 'validator_rejection',
        toolName: toolContract.name,
        toolCall: toolCall.value,
        result: toolResult
      });

      if (toolResult.valid && toolResult.normalizedValue) {
        successfulValidatedValue = toolResult.normalizedValue;
      }

      continue;
    }

    if (toolCall.kind === 'malformed_tool_call') {
      history.push({
        role: 'tool',
        turn,
        kind: 'malformed_tool_call_envelope',
        toolName: toolContract.name,
        source: 'model_output',
        toolCall: toolCall.envelope || parsedObject.value,
        result: {
          ok: false,
          valid: false,
          toolName: toolContract.name,
          summary: toolCall.summary,
          errors: toolCall.errors || [],
          malformedEnvelope: true
        }
      });
      continue;
    }

    if (validatorCalls >= toolLoopConfig.maxValidatorCalls) {
      throw createRetryableError(`invalid_output: exceeded ${toolContract.name} tool-call limit`, {
        group: 'tool_loop',
        raw: rawContent || null,
        extracted: parsedObject.meta?.extracted || null,
        validationErrors: [{
          path: '$',
          code: 'tool_call_limit_exceeded',
          message: `Exceeded ${toolContract.name} tool-call limit before ${artifactLabel} could be validated.`
        }],
        validationSummary: `Exceeded ${toolContract.name} tool-call limit before ${artifactLabel} could be validated.`,
        completion,
        promptMode,
        promptRef: promptRef ? { sha256: promptRef.sha256, file: promptRef.file } : null,
        toolLoop: {
          toolName: toolContract.name,
          maxTurns: toolLoopConfig.maxTurns,
          maxValidatorCalls: toolLoopConfig.maxValidatorCalls,
          turn,
          validatorCalls,
          history
        }
      });
    }

    validatorCalls += 1;
    const autoToolArgs = { [toolContract.argumentKey]: parsedObject.value };
    const toolResult = executeValidatorTool(autoToolArgs);

    history.push({
      role: 'tool',
      turn,
      kind: successfulValidatedValue
        ? (toolResult.valid ? finalArtifactAcceptedKind : 'final_artifact_rejection')
        : (toolResult.valid ? autoValidationKind : 'validator_rejection'),
      toolName: toolContract.name,
      source: successfulValidatedValue ? 'final_artifact_auto_validation' : 'auto_validate_candidate_json',
      toolCall: {
        tool: toolContract.name,
        [toolContract.argumentKey]: autoToolArgs[toolContract.argumentKey],
        arguments: autoToolArgs
      },
      result: toolResult
    });

    if (!toolResult.valid) {
      continue;
    }

    const validatedValue = toolResult.normalizedValue;

    if (!successfulValidatedValue) {
      successfulValidatedValue = validatedValue;
    }

    const finalNormalized = normalizeValidatedValue(validatedValue);
    const priorNormalized = normalizeValidatedValue(successfulValidatedValue);

    if (finalNormalized !== priorNormalized) {
      successfulValidatedValue = validatedValue;
      continue;
    }

    if (events) {
      events.emit({
        kind: 'tool.loop.complete',
        phase: phaseKey,
        script: scriptId,
        domain,
        attempt: ctx?.attempt,
        attemptInTarget: ctx?.attemptInTarget,
        targetIndex: ctx?.targetIndex,
        validatorCalls,
        turns: turn,
        toolName: toolContract.name,
        provider: adapter?.name || null,
        model: adapter?.model || null,
      });
    }

    return {
      completion,
      parsed: validatedValue,
      requestPrompt: {
        mode: promptMode,
        repairSummary: null
      },
      toolLoop: {
        toolName: toolContract.name,
        maxTurns: toolLoopConfig.maxTurns,
        maxValidatorCalls: toolLoopConfig.maxValidatorCalls,
        turns: turn,
        validatorCalls,
        history,
        finalArtifact: validatedValue
      }
    };
  }

  throw createRetryableError(`invalid_output: ${artifactLabel} tool loop exhausted after ${toolLoopConfig.maxTurns} turns`, {
    group: 'tool_loop',
    raw: finalCompletion?.content || null,
    extracted: null,
    parseError: null,
    validationErrors: [{
      path: '$',
      code: 'tool_loop_exhausted',
      message: `${artifactLabel} tool loop exhausted after ${toolLoopConfig.maxTurns} turns.`
    }],
    validationSummary: `${artifactLabel} tool loop exhausted after ${toolLoopConfig.maxTurns} turns. Ensure the model validates the ${artifactLabel} and then returns final JSON only.`,
    completion: finalCompletion,
    promptMode: finalPromptMode,
    promptRef: promptRef ? { sha256: promptRef.sha256, file: promptRef.file } : null,
    toolLoop: {
      toolName: toolContract.name,
      maxTurns: toolLoopConfig.maxTurns,
      maxValidatorCalls: toolLoopConfig.maxValidatorCalls,
      turns: toolLoopConfig.maxTurns,
      validatorCalls,
      history
    }
  });
}

module.exports = {
  defaultNormalizeForComparison,
  parseValidatorToolCallEnvelope,
  buildLocalValidatorToolPrompt,
  executeLocalValidatorToolLoop
};
