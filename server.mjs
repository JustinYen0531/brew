import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SITE_FILE = path.join(ROOT, 'outputs', 'vibe-coding-daily-brew', 'index.html');
const ENV_FILE = path.join(ROOT, '.env.local');

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return {};
  return Object.fromEntries(readFileSync(filePath, 'utf8').split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (!match) return [];
    return [[match[1], match[2].replace(/^['"]|['"]$/g, '')]];
  }));
}

const config = { ...loadDotEnv(ENV_FILE), ...process.env };
const PORT = Number(config.PORT || 4173);
const MODEL = config.OPENROUTER_MODEL || 'deepseek/deepseek-v4-flash-0731';
const API_URL = 'https://openrouter.ai/api/v1/chat/completions';

const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

function sendJson(res, status, body) {
  res.writeHead(status, jsonHeaders);
  res.end(JSON.stringify(body));
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function sanitizePreferences(raw = {}) {
  const sources = ['facebook', 'reddit', 'github'];
  const sourceWeights = Object.fromEntries(sources.map(source => [source, Math.round(clamp(raw.sourceWeights?.[source], 1, 5, 3))]));
  const specificSources = Object.fromEntries(sources.map(source => [source, typeof raw.specificSources?.[source] === 'string' ? raw.specificSources[source].trim().slice(0, 160) : '']));
  const directUrls = Array.isArray(raw.directUrls) ? raw.directUrls.filter(url => typeof url === 'string' && /^https?:\/\//i.test(url.trim())).map(url => url.trim().slice(0, 500)).slice(0, 10) : [];
  return { sourceWeights, specificSources, prompt: typeof raw.prompt === 'string' ? raw.prompt.trim().slice(0, 1000) : '', directUrls, language: raw.language === 'en' ? 'en' : 'zh-Hant' };
}

function preferenceBrief(preferences) {
  const language = preferences.language === 'en' ? 'English' : '繁體中文';
  const weightedSources = Object.entries(preferences.sourceWeights).map(([source, weight]) => `${source}=${weight}/5`).join('、');
  const specificSources = Object.entries(preferences.specificSources).filter(([, value]) => value).map(([source, value]) => `${source}: ${value}`).join('；') || '沒有指定特定社群';
  const directSources = preferences.directUrls.length ? preferences.directUrls.join('\n') : '沒有硬性網址限制';
  return `\n\n【使用者本次偏好】\n資訊源頭語言偏好：${language}（最後整理仍請使用繁體中文）\n來源機率權重（1=盡量不要，3=正常，5=更多）：${weightedSources}\n特定社群偏好（prompt 提示）：${specificSources}\n額外 prompt：${preferences.prompt || '沒有額外 prompt'}\n硬性網址來源（若有，只能從這些網址或其頁面翻找）：\n${directSources}\n請嚴格區分「偏好」與「硬性網址」：偏好是排序訊號；硬性網址是來源限制。`;
}

function readRequestBody(req, maxBytes = 100_000) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      raw += chunk;
      if (Buffer.byteLength(raw) > maxBytes) {
        reject(new Error('request_too_large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(part => typeof part === 'string' ? part : part?.text || '').join('');
  return '';
}

function parseJsonAnswer(text) {
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('model_json_missing');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function normalizeItems(payload, count) {
  if (!payload || !Array.isArray(payload.items)) throw new Error('model_items_missing');
  const required = ['title', 'category', 'takeaway', 'problem', 'principle', 'try_it', 'tradeoffs', 'practice_prompt'];
  const items = payload.items.slice(0, count).filter(item => required.every(key => typeof item?.[key] === 'string' && item[key].trim()));
  if (items.length !== count) throw new Error('model_items_incomplete');
  return items.map((item, index) => {
    const source = item.source && typeof item.source === 'object' ? item.source : {};
    const url = typeof source.url === 'string' && /^https?:\/\//i.test(source.url) ? source.url : '';
    return {
      n: String(index + 1).padStart(2, '0'),
      category: item.category.trim(),
      tag: item.tag || '即時選集',
      title: item.title.trim(),
      takeaway: item.takeaway.trim(),
      timeless: clamp(item.scores?.timeless, 1, 5, 3),
      importance: clamp(item.scores?.importance, 1, 5, 3),
      heat: clamp(item.scores?.popularity, 1, 5, 2),
      time: item.time || '6 分鐘',
      source: source.platform ? `${source.platform} · 即時來源` : '即時社群來源',
      sourceType: source.platform || '社群討論',
      date: source.published_at || new Date().toISOString().slice(0, 10),
      classic: false,
      problem: item.problem.trim(),
      principle: item.principle.trim(),
      tryIt: item.try_it.trim(),
      tradeoffs: item.tradeoffs.trim(),
      prompt: item.practice_prompt.trim(),
      evidence: item.source_says || item.editorial_synthesis || '這篇內容由即時選集整理而成，請開啟來源確認原始上下文。',
      url
    };
  });
}

function buildPrompt(count, preferences) {
  const runDate = new Date().toISOString().slice(0, 10);
  return `今天是 ${runDate}。請使用可用的 web search，找出近期社群中與 Vibe Coding 相關、具體且可重複的實作方法，並整理成 ${count} 篇繁體中文學習內容。不要做產品新聞、模型發布摘要或空泛金句。每篇都必須說明問題、可轉移原則、可操作範例、限制、練習題與來源證據。${preferenceBrief(preferences)}\n\n請只回傳 JSON object，不要 Markdown，不要前言，格式必須是：\n{"items":[{"title":"...","category":"思考|提示設計|Agent 管理|上下文工程|程式碼理解|驗證|工作流程|工藝與心態|安全|協作|學習系統","tag":"新鮮實作|近期耐用|舊作高價值","takeaway":"...","problem":"...","principle":"...","try_it":"...","tradeoffs":"...","practice_prompt":"...","source_says":"...","editorial_synthesis":"...","source":{"url":"https://...","platform":"...","author":"...","published_at":"YYYY-MM-DD","evidence_excerpt":"...","popularity_basis":"..."},"scores":{"timeless":1,"importance":1,"popularity":1}}]}\n\n評分必須是 1 到 5 的數字。來源 URL、作者、日期與證據不確定時，請如實降低評分或排除，不要捏造。`;
}

async function brew(count, preferences) {
  const key = config.OPENROUTER_API_KEY?.trim();
  if (!key) throw Object.assign(new Error('api_key_missing'), { status: 503 });
  const upstream = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': `http://localhost:${PORT}`,
      'X-Title': 'Vibe Coding Daily Brew'
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: '你是 Vibe Coding Daily Brew 的嚴謹中文編輯。只保留有證據、可轉移、可實作的做法。' },
        { role: 'user', content: buildPrompt(count, preferences) }
      ],
      temperature: 0.35,
      max_tokens: 8000,
      plugins: [{ id: 'web' }],
      response_format: { type: 'json_object' }
    }),
    signal: AbortSignal.timeout(30_000)
  });
  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    console.error(`OpenRouter request failed: HTTP ${upstream.status}`);
    throw Object.assign(new Error('upstream_failed'), { status: 502 });
  }
  const answer = extractText(data.choices?.[0]?.message?.content);
  return normalizeItems(parseJsonAnswer(answer), count);
}

async function serveSite(res) {
  const fileStat = await stat(SITE_FILE);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': fileStat.size, 'Cache-Control': 'no-store' });
  res.end(await readFile(SITE_FILE));
}

const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (requestUrl.pathname === '/api/health' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, model: MODEL, configured: Boolean(config.OPENROUTER_API_KEY?.trim()) });
    }
    if (requestUrl.pathname === '/api/brew' && req.method === 'POST') {
      const body = JSON.parse(await readRequestBody(req) || '{}');
      const count = Number(body.count);
      if (!Number.isInteger(count) || count < 1 || count > 10) return sendJson(res, 400, { error: '篇數必須是 1 到 10 之間的整數。' });
      return sendJson(res, 200, { items: await brew(count, sanitizePreferences(body.preferences)), model: MODEL });
    }
    if (req.method === 'GET' && (requestUrl.pathname === '/' || requestUrl.pathname === '/index.html')) return serveSite(res);
    return sendJson(res, 404, { error: 'not_found' });
  } catch (error) {
    const status = error.status || (error.message === 'request_too_large' ? 413 : error instanceof SyntaxError ? 400 : 500);
    const message = error.message === 'api_key_missing' ? '尚未設定 API key。請在 .env.local 設定 OPENROUTER_API_KEY。' : error.message === 'model_items_incomplete' || error.message === 'model_json_missing' ? '模型回傳內容不完整，請稍後再試。' : error.message === 'upstream_failed' ? '即時來源暫時無法回應，請稍後再試。' : '手沖服務暫時無法使用。';
    console.error(`Request failed: ${error.message}`);
    return sendJson(res, status, { error: message });
  }
});

server.listen(PORT, () => {
  console.log(`Vibe Coding 每日手沖 running at http://localhost:${PORT}`);
});
