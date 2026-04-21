'use strict';

/**
 * server/llm_backends/gemini.js — Google Gemini API backend
 *
 * Calls the Gemini REST API using Node's built-in https module.
 * No external SDK dependency.
 *
 * Endpoint:
 *   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={API_KEY}
 *
 * The system instruction and temperature=0 + JSON mime type ensure the model
 * produces structured, deterministic output matching the Sec-IR schema.
 */

const https = require('https');

const DEFAULT_MODEL = 'gemini-2.5-flash';

/**
 * Make a single Gemini generateContent call.
 *
 * @param {string} systemPrompt  Full system instruction text.
 * @param {string} userMessage   The user query (may include the correction prompt).
 * @param {string} apiKey        Gemini API key.
 * @param {string} [model]       Model override.
 * @returns {Promise<string>}    Raw response text (may be JSON or wrapped JSON).
 */
function callGemini(systemPrompt, userMessage, apiKey, model) {
  const chosenModel = model || DEFAULT_MODEL;
  const path = `/v1beta/models/${chosenModel}:generateContent?key=${apiKey}`;

  const body = JSON.stringify({
    system_instruction: {
      parts: [{ text: systemPrompt }],
    },
    contents: [
      { role: 'user', parts: [{ text: userMessage }] },
    ],
    generationConfig: {
      temperature:      0.0,
      responseMimeType: 'application/json',
    },
  });

  return new Promise(function(resolve, reject) {
    const options = {
      hostname: 'generativelanguage.googleapis.com',
      port:     443,
      path:     path,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
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
            return reject(new Error(`Gemini API error ${res.statusCode}: ${errMsg}`));
          }

          // Extract text from the response envelope
          const text =
            parsed.candidates &&
            parsed.candidates[0] &&
            parsed.candidates[0].content &&
            parsed.candidates[0].content.parts &&
            parsed.candidates[0].content.parts[0] &&
            parsed.candidates[0].content.parts[0].text;

          if (typeof text !== 'string') {
            return reject(new Error('Gemini response missing expected text field: ' + data));
          }

          resolve(extractJson(text));
        } catch (e) {
          reject(new Error('Failed to parse Gemini response: ' + e.message));
        }
      });
    });

    req.on('error', function(err) {
      reject(new Error('Gemini HTTPS request failed: ' + err.message));
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

module.exports = { callGemini };
