'use strict';

/**
 * server/llm_backends/ollama.js — Local Ollama HTTP backend
 *
 * Calls a locally running Ollama server via its REST API.
 * Default endpoint: POST http://localhost:11434/api/generate
 *
 * Requires Ollama 0.1+ running locally with a model pulled:
 *   ollama pull phi3.5
 *
 * The format field uses Ollama 0.5+ schema syntax ({ type: "object" }) to
 *  request JSON output.  Older Ollama builds that only accept the string "json"
 *  will receive this as a no-op and may wrap the output in text — the
 *  extractJson helper handles that case.
 */

const http  = require('http');
const https = require('https');

const DEFAULT_MODEL    = 'gemma:4b';
const DEFAULT_BASE_URL = 'http://localhost:11434';

/**
 * Make a single Ollama generate call (streaming, collects full response).
 *
 * @param {string} systemPrompt  Full system instruction text.
 * @param {string} userMessage   The user query.
 * @param {string} [baseUrl]     Ollama server URL (default: http://localhost:11434).
 * @param {string} [model]       Model override (default: phi3.5).
 * @returns {Promise<string>}    Raw response text.
 */
function callOllama(systemPrompt, userMessage, baseUrl, model) {
  const chosenBaseUrl = baseUrl || DEFAULT_BASE_URL;
  const chosenModel   = model   || DEFAULT_MODEL;

  // Combine system prompt and user message into a single prompt
  // (Ollama's /api/generate does not have a separate system field in all versions)
  const fullPrompt = systemPrompt + '\n\nUser query: ' + userMessage + '\n\nRespond with only the Sec-IR JSON object, no other text.';

  const body = JSON.stringify({
    model:  chosenModel,
    prompt: fullPrompt,
    format: { type: 'object' },  // Ollama 0.5+ JSON mode
    stream: true,
    options: {
      temperature: 0,
      num_predict: 2048,
    },
  });

  const url     = new URL(chosenBaseUrl + '/api/generate');
  const isHttps = url.protocol === 'https:';
  const lib     = isHttps ? https : http;

  return new Promise(function(resolve, reject) {
    const options = {
      hostname: url.hostname,
      port:     url.port || (isHttps ? 443 : 80),
      path:     url.pathname,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = lib.request(options, function(res) {
      let fullResponse = '';

      res.on('data', function(chunk) {
        // Ollama streams newline-delimited JSON objects
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            fullResponse += (obj.response || '');
            if (obj.done) return;
          } catch (_) {
            // Incomplete chunk — accumulate and continue
          }
        }
      });

      res.on('end', function() {
        resolve(extractJson(fullResponse));
      });
    });

    req.on('error', function(err) {
      reject(new Error(
        `Cannot reach Ollama at ${chosenBaseUrl}. ` +
        `Ensure it is running (ollama serve) and OLLAMA_HOST is correct. ` +
        `Original error: ${err.message}`
      ));
    });

    req.write(body);
    req.end();
  });
}

/**
 * Strip markdown code fences from model output.
 * @param {string} text
 * @returns {string}
 */
function extractJson(text) {
  const stripped = text.trim();
  const fenced = stripped.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) return fenced[1].trim();
  return stripped;
}

module.exports = { callOllama };
