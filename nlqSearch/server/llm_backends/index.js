'use strict';

/**
 * server/llm_backends/index.js — LLM backend factory
 *
 * Picks the correct backend (Gemini or Ollama) based on config and exposes
 * a single unified callLLM() function.
 *
 * Swapping backends is a single config change — either set NLQ_BACKEND=ollama
 * in the environment or pass backend='ollama' to callLLM().
 *
 * Interface:
 *   callLLM(systemPrompt, userMessage, config) → Promise<string>
 *
 * config shape:
 *   {
 *     backend:    'gemini' | 'ollama',   // required
 *     apiKey:     string,                // Gemini only
 *     model:      string,                // optional model override
 *     ollamaUrl:  string,                // Ollama base URL override
 *   }
 */

const { callGemini } = require('./gemini');
const { callOllama } = require('./ollama');

/**
 * Unified LLM call.  Delegates to the appropriate backend.
 *
 * @param {string} systemPrompt  Full system instruction.
 * @param {string} userMessage   User query (or correction prompt).
 * @param {object} config        Backend configuration (see module JSDoc).
 * @returns {Promise<string>}    Raw LLM output text.
 */
async function callLLM(systemPrompt, userMessage, config) {
  const backend = config.backend || detectBackend(config);

  if (backend === 'gemini') {
    if (!config.apiKey) {
      throw new Error(
        'Gemini backend selected but GEMINI_API_KEY is not set. ' +
        'Set the environment variable or switch to NLQ_BACKEND=ollama.'
      );
    }
    return callGemini(systemPrompt, userMessage, config.apiKey, config.model);
  }

  if (backend === 'ollama') {
    return callOllama(systemPrompt, userMessage, config.ollamaUrl, config.model);
  }

  throw new Error(`Unknown LLM backend: "${backend}". Use "gemini" or "ollama".`);
}

/**
 * Auto-detect which backend to use based on available credentials/config.
 * @param {object} config
 * @returns {string} 'gemini' | 'ollama'
 */
function detectBackend(config) {
  if (config.apiKey || process.env.GEMINI_API_KEY) return 'gemini';
  return 'ollama';
}

module.exports = { callLLM };
