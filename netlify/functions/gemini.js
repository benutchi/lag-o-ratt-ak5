// --- Klassrums-skydd mot spam / 429 ---
const lastHitByClient = new Map();
const MIN_MS_PER_CLIENT = 10_000; // 10 sek

// netlify/functions/gemini.js

function reply(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
"Access-Control-Allow-Headers": "Content-Type, X-Client-Id",      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    },
    body: JSON.stringify(body),
  };
}
const CACHE = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minuter
exports.handler = async function (event) {  const clientId =
    event.headers["x-client-id"] ||
    event.headers["x-nf-client-connection-ip"] ||
    event.headers["x-forwarded-for"] ||
    "unknown";

 

  try {
    // 1) Preflight
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: reply(204, {}).headers, body: "" };
    }

    // 2) GET ska fungera i webbläsaren
    if (event.httpMethod === "GET") {
      return reply(200, {
        ok: true,
        message: "Gemini function is alive. Send POST with JSON: { q, systemPrompt }",
      });
    }

    // 3) Endast POST för AI anrop
    if (event.httpMethod !== "POST") {
      return reply(405, { error: "Method not allowed. Use POST." });
    }

    const raw = event.body || "";
    if (!raw.trim()) {
      return reply(400, { error: "Missing JSON body. Send { q, systemPrompt }" });
    }

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return reply(400, { error: "Invalid JSON body." });
    }

    const q = body.q || "";
    const systemPrompt = body.systemPrompt || "";

    if (!q) return reply(400, { error: "Missing field: q" });
const cacheKey = JSON.stringify({ q, systemPrompt });

const cached = CACHE.get(cacheKey);
if (cached && Date.now() - cached.time < CACHE_TTL) {
  return reply(200, { text: cached.text, cached: true });
}
    const now = Date.now();
const last = lastHitByClient.get(clientId) || 0;


lastHitByClient.set(clientId, Date.now());   // RIKTIGT ANROP TILL GEMINI
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  return reply(500, { error: "Missing GEMINI_API_KEY in Netlify environment variables." });
}

// Du kan byta modell senare, men börja med en stabil standard
const model = "gemini-2.5-flash";
const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

const payload = {
  contents: [
    {
      role: "user",
      parts: [{ text: `${systemPrompt}\n\nFRÅGA: ${q}` }],
    },
  ],
};

const r = await fetch(endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

const text = await r.text();

// Om Gemini svarar med fel (4xx/5xx), skicka tillbaka texten så vi ser exakt varför
if (!r.ok) {
  return reply(r.status, { error: `Gemini error (HTTP ${r.status})`, details: text });
}

// Gemini svarar redan som JSON
let data;
try {
  data = JSON.parse(text);
} catch {
  return reply(500, { error: "Gemini returned non-JSON response.", details: text });
}

// Skicka tillbaka i samma format som din frontend redan läser
   // Plocka ut text ur Gemini-svaret
const parts = data?.candidates?.[0]?.content?.parts || [];
const outText = parts.map(p => p?.text || "").join("").trim();

const blockReason =
  data?.promptFeedback?.blockReason ||
  data?.candidates?.[0]?.finishReason ||
  "";

if (!outText) {
  return reply(200, {
    text: `Tomt svar från Gemini. Orsak: ${blockReason || "okänd"}`
  });
}

CACHE.set(cacheKey, { time: Date.now(), text: outText });
return reply(200, { text: outText });
  } catch (e) {
    return reply(500, { error: String(e?.message || e) });
  }
};
