'use strict';

/**
 * server/llm_backends/groq.js — Groq Cloud API backend
 *
 * Calls Groq's OpenAI-compatible chat completions endpoint using Node's
 * built-in https module.  No external SDK required.
 *
 * Endpoint:
 *   POST https://api.groq.com/openai/v1/chat/completions
 *
 * Auth:
 *   Authorization: Bearer <GROQ_API_KEY>
 *
 * The json_object response format and temperature=0 keep output deterministic
 * and ensure the model returns raw JSON matching the Sec-IR schema.
 */

const https = require('https');

const DEFAULT_MODEL  = 'llama-3.3-70b-versatile';
const GROQ_API_HOST  = 'api.groq.com';
const GROQ_API_PATH  = '/openai/v1/chat/completions';

/**
 * Make a single Groq chat completions call.
 *
 * @param {string} systemPrompt  Full system instruction text.
 * @param {string} userMessage   The user query (may include correction prompt).
 * @param {string} apiKey        Groq API key.
 * @param {string} [model]       Model override.
 * @returns {Promise<string>}    Raw response text (JSON string).
 */
function callGroq(systemPrompt, userMessage, apiKey, model) {
  const chosenModel = model || DEFAULT_MODEL;

  const body = JSON.stringify({
    model:           chosenModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userMessage  },
    ],
    temperature:     0,
    response_format: { type: 'json_object' },
  });

  return new Promise(function(resolve, reject) {
    const options = {
      hostname: GROQ_API_HOST,
      port:     443,
      path:     GROQ_API_PATH,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Authorization':  'Bearer ' + apiKey,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, function(res) {
      let data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try {
          const parsed = JSON.parse(data);

          // HTTP-level errors (4xx / 5xx)
          if (res.statusCode >= 400) {
            const errMsg = (parsed.error && parsed.error.message) || data;
            return reject(new Error(`Groq API error ${res.statusCode}: ${errMsg}`));
          }

          // Extract the message content from the OpenAI-format response envelope
          const text =
            parsed.choices &&
            parsed.choices[0] &&
            parsed.choices[0].message &&
            parsed.choices[0].message.content;

          if (typeof text !== 'string') {
            return reject(new Error('Groq response missing expected content field: ' + data));
          }

          resolve(extractJson(text));
        } catch (e) {
          reject(new Error('Failed to parse Groq response: ' + e.message));
        }
      });
    });

    req.on('error', function(err) {
      reject(new Error('Groq HTTPS request failed: ' + err.message));
    });

    req.write(body);
    req.end();
  });
}

/**
 * Strip markdown code fences that models sometimes wrap JSON output in.
 * @param {string} text
 * @returns {string}
 */
function extractJson(text) {
  const stripped = text.trim();
  const fenced = stripped.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) return fenced[1].trim();
  return stripped;
}

module.exports = { callGroq };
