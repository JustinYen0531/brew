import { createServer } from 'node:http';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverSources, rankSources, readSourceCatalog, sourceMatchesQuery, SOURCE_RANKING_VERSION } from './source-catalog.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SITE_FILE = path.join(ROOT, 'outputs', 'vibe-coding-daily-brew', 'index.html');
const DAILY_DIR = path.join(ROOT, 'outputs', 'vibe-coding-daily-brew', 'daily');
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
const REQUEST_TIMEOUT_MS = 45_000;
const RETRY_TIMEOUT_MS = 30_000;
const MAX_BREW_ATTEMPTS = 2;

const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

function localDate() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function dateOnly(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

function normalizeTargetDate(value) {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : localDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || dateOnly(`${raw}T00:00:00Z`) !== raw) {
    throw Object.assign(new Error('invalid_date'), { status: 400 });
  }
  if (raw > localDate()) throw Object.assign(new Error('future_date'), { status: 400 });
  return raw;
}

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
  const selectedSources = Array.isArray(raw.selectedSources) ? raw.selectedSources.filter(source => source && typeof source === 'object' && typeof source.url === 'string' && /^https?:\/\//i.test(source.url)).slice(0, 20).map(source => ({
    id: typeof source.id === 'string' ? source.id.slice(0, 100) : '',
    name: typeof source.name === 'string' ? source.name.trim().slice(0, 160) : '',
    platform: typeof source.platform === 'string' ? source.platform.trim().slice(0, 100) : '',
    url: source.url.trim().slice(0, 500),
    kind: typeof source.kind === 'string' ? source.kind.trim().slice(0, 100) : ''
  })) : [];
  const customSources = Array.isArray(raw.customSources) ? raw.customSources.filter(source => source && typeof source === 'object' && typeof source.url === 'string' && /^https?:\/\//i.test(source.url)).slice(0, 10).map(source => ({
    id: typeof source.id === 'string' ? source.id.slice(0, 100) : '',
    name: typeof source.name === 'string' ? source.name.trim().slice(0, 160) : '',
    platform: '自訂來源',
    url: source.url.trim().slice(0, 500),
    kind: '使用者新增'
  })) : [];
  return { sourceWeights, specificSources, selectedSources, customSources, prompt: typeof raw.prompt === 'string' ? raw.prompt.trim().slice(0, 1000) : '', directUrls, language: raw.language === 'en' ? 'en' : 'zh-Hant' };
}

function preferenceBrief(preferences) {
  const language = preferences.language === 'en' ? 'English' : '繁體中文';
  const weightedSources = Object.entries(preferences.sourceWeights).map(([source, weight]) => `${source}=${weight}/5`).join('、');
  const specificSources = Object.entries(preferences.specificSources).filter(([, value]) => value).map(([source, value]) => `${source}: ${value}`).join('；') || '沒有指定特定社群';
  const selectedSources = [...(preferences.selectedSources || []), ...(preferences.customSources || [])].map(source => `${source.name || source.platform || '未命名來源'} <${source.url}>`).join('；') || '尚未選取來源';
  const directSources = preferences.directUrls.length ? preferences.directUrls.join('\n') : '沒有硬性網址限制';
  return `\n\n【使用者本次偏好】\n資訊源頭語言偏好：${language}（最後整理仍請使用繁體中文）\n來源機率權重（舊版相容）：${weightedSources}\n來源資料庫中使用者選取的提供者：${selectedSources}\n特定社群偏好（舊版相容）：${specificSources}\n額外 prompt：${preferences.prompt || '沒有額外 prompt'}\n硬性網址來源（若有，只能從這些網址或其頁面翻找）：\n${directSources}\n請嚴格區分「來源推薦／偏好」與「硬性網址」：偏好是排序訊號；硬性網址是來源限制。不要因為某來源被選取，就降低來源證據與日期驗證標準。`;
}

function allowedSearchDomains(preferences) {
  const domains = new Set();
  for (const value of preferences.directUrls) {
    try {
      const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, '');
      if (hostname) domains.add(hostname);
    } catch {}
  }
  return [...domains].slice(0, 10);
}

function buildSearchTool(preferences, compact) {
  const parameters = {
    engine: 'exa',
    max_results: compact ? 2 : 3,
    max_total_results: compact ? 4 : 6,
    max_uses: compact ? 1 : 2,
    search_context_size: 'low'
  };
  const domains = allowedSearchDomains(preferences);
  if (domains.length) parameters.allowed_domains = domains;
  return { type: 'openrouter:web_search', parameters };
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
  if (content && typeof content.text === 'string') return content.text;
  return '';
}

function parseJsonAnswer(text) {
  const cleaned = String(text || '').replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  if (!cleaned) throw new Error('model_response_empty');
  try { return JSON.parse(cleaned); } catch {}
  for (let start = cleaned.indexOf('{'); start !== -1; start = cleaned.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < cleaned.length; index += 1) {
      const character = cleaned[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === '{') depth += 1;
      else if (character === '}') {
        depth -= 1;
        if (depth === 0) {
          try { return JSON.parse(cleaned.slice(start, index + 1)); } catch { break; }
        }
      }
    }
  }
  throw new Error(cleaned.includes('{') ? 'model_json_incomplete' : 'model_json_missing');
}

function normalizeItems(payload, count, asOfDate) {
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
      date: dateOnly(source.published_at) || asOfDate,
      classic: false,
      problem: item.problem.trim(),
      principle: item.principle.trim(),
      tryIt: item.try_it.trim(),
      tradeoffs: item.tradeoffs.trim(),
      prompt: item.practice_prompt.trim(),
      evidence: item.source_says || item.editorial_synthesis || '這篇內容由即時選集整理而成，請開啟來源確認原始上下文。',
      url
    };
  }).filter(item => item.date <= asOfDate);
  if (items.length !== count) throw new Error('source_after_as_of_date');
  return items;
}

function buildPrompt(count, preferences, asOfDate) {
  return `資料截點是 ${asOfDate}。請使用可用的 web search，找出在 ${asOfDate} 當天或之前已經存在的、與 Vibe Coding 相關、具體且可重複的實作方法，並整理成 ${count} 篇繁體中文學習內容。嚴格禁止使用 ${asOfDate} 之後發布、更新或發生的發現，所有 source.published_at 必須小於或等於 ${asOfDate}。不要做產品新聞、模型發布摘要或空泛金句。每篇都必須說明問題、可轉移原則、可操作範例、限制、練習題與來源證據。${preferenceBrief(preferences)}\n\n請只回傳 JSON object，不要 Markdown，不要前言，格式必須是：\n{"items":[{"title":"...","category":"思考|提示設計|Agent 管理|上下文工程|程式碼理解|驗證|工作流程|工藝與心態|安全|協作|學習系統","tag":"新鮮實作|近期耐用|舊作高價值","takeaway":"...","problem":"...","principle":"...","try_it":"...","tradeoffs":"...","practice_prompt":"...","source_says":"...","editorial_synthesis":"...","source":{"url":"https://...","platform":"...","author":"...","published_at":"YYYY-MM-DD","evidence_excerpt":"...","popularity_basis":"..."},"scores":{"timeless":1,"importance":1,"popularity":1}}]}\n\n評分必須是 1 到 5 的數字。來源 URL、作者、日期與證據不確定時，請如實降低評分或排除，不要捏造。`;
}

function buildRequestPrompt(count, preferences, asOfDate, compact = false) {
  const prompt = buildPrompt(count, preferences, asOfDate);
  return compact ? `${prompt}\n\n這是重試版本：每篇各欄位只寫 1 到 2 句，整篇控制在約 350 個中文字內，務必在一次回覆中完成全部 ${count} 篇。` : prompt;
}

async function requestUpstream(key, count, preferences, asOfDate, attempt) {
  const compact = attempt > 0;
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
        { role: 'user', content: buildRequestPrompt(count, preferences, asOfDate, compact) }
      ],
      temperature: compact ? 0.15 : 0.25,
      max_tokens: compact ? 5600 : 7000,
      tools: [buildSearchTool(preferences, compact)],
      plugins: [{ id: 'response-healing' }],
      response_format: { type: 'json_object' }
    }),
    signal: AbortSignal.timeout(compact ? RETRY_TIMEOUT_MS : REQUEST_TIMEOUT_MS)
  });
  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    console.error(`OpenRouter request failed: HTTP ${upstream.status}`);
    throw Object.assign(new Error('upstream_failed'), { status: 502, upstreamStatus: upstream.status });
  }
  const choice = data.choices?.[0] || {};
  if (choice.error) {
    console.error(`OpenRouter model response failed: ${choice.error.code || 'unknown'}`);
    throw Object.assign(new Error('model_response_error'), { status: 502 });
  }
  const answer = extractText(choice.message?.content);
  return normalizeItems(parseJsonAnswer(answer), count, asOfDate);
}

function isTimeoutError(error) {
  return error?.name === 'TimeoutError' || error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
}

function isRetryableModelError(error) {
  return ['model_response_empty', 'model_response_error', 'model_json_missing', 'model_json_incomplete', 'model_items_missing', 'model_items_incomplete'].includes(error?.message);
}

function publicErrorMessage(error) {
  if (error.message === 'api_key_missing') return '尚未設定 API key。請在 .env.local 設定 OPENROUTER_API_KEY。';
  if (isTimeoutError(error)) return '即時搜尋逾時，請稍後再試；若一次篇數較多，可先改成 3 篇。';
  if (['model_response_empty', 'model_response_error', 'model_json_missing', 'model_json_incomplete', 'model_items_missing', 'model_items_incomplete'].includes(error.message)) return '模型回覆格式不完整，請稍後再試。';
  if (error.message === 'upstream_failed') return '即時來源暫時無法回應，請稍後再試。';
  return '手沖服務暫時無法使用。';
}

async function brew(count, preferences, asOfDate) {
  const key = config.OPENROUTER_API_KEY?.trim();
  if (!key) throw Object.assign(new Error('api_key_missing'), { status: 503 });
  let lastError;
  for (let attempt = 0; attempt < MAX_BREW_ATTEMPTS; attempt += 1) {
    try {
      return await requestUpstream(key, count, preferences, asOfDate, attempt);
    } catch (error) {
      lastError = error;
      if (attempt + 1 >= MAX_BREW_ATTEMPTS || !isRetryableModelError(error)) throw error;
      console.error(`Retrying brew after ${error.message}`);
    }
  }
  throw lastError;
}

async function serveSite(res) {
  const fileStat = await stat(SITE_FILE);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': fileStat.size, 'Cache-Control': 'no-store' });
  res.end(await readFile(SITE_FILE));
}

async function readEdition(date = 'latest') {
  const filePath = path.join(DAILY_DIR, `${date}.json`);
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeEdition(date, edition) {
  await mkdir(DAILY_DIR, { recursive: true });
  const filePath = path.join(DAILY_DIR, `${date}.json`);
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(edition, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, filePath);
}

async function listArchive(month) {
  let names = [];
  try { names = await readdir(DAILY_DIR); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const dates = names
    .map(name => name.match(/^(\d{4}-\d{2}-\d{2})\.json$/)?.[1])
    .filter(Boolean)
    .filter(date => !month || date.startsWith(month))
    .sort((a, b) => b.localeCompare(a));
  return Promise.all(dates.map(async date => {
    const edition = await readEdition(date);
    return { date, count: Array.isArray(edition.items) ? edition.items.length : 0, generated_at: edition.generated_at || '', mode: edition.mode || 'daily' };
  }));
}

function createEdition(date, items, mode = 'historical') {
  return {
    run_date: date,
    mode,
    requested_count: items.length,
    title: 'Vibe Coding 每日手沖',
    objective: mode === 'historical'
      ? `模擬網站在 ${date} 當天已存在時，從當時可見的發現中手沖十份可驗證、可轉移的 Vibe Coding 做法。`
      : '從當前社群討論中挑出十個可驗證、可轉移、值得留下的 Vibe Coding 做法。',
    generated_at: new Date().toISOString(),
    items
  };
}

const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (requestUrl.pathname === '/api/health' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, model: MODEL, configured: Boolean(config.OPENROUTER_API_KEY?.trim()) });
    }
    if (requestUrl.pathname === '/api/archive' && req.method === 'GET') {
      const requestedDate = requestUrl.searchParams.get('date');
      if (requestedDate) {
        const date = requestedDate === 'latest' ? 'latest' : normalizeTargetDate(requestedDate);
        try { return sendJson(res, 200, await readEdition(date)); }
        catch (error) { if (error.code === 'ENOENT') return sendJson(res, 404, { error: '找不到這一天的手沖。' }); throw error; }
      }
      const month = requestUrl.searchParams.get('month') || '';
      if (month && !/^\d{4}-\d{2}$/.test(month)) return sendJson(res, 400, { error: '月份格式必須是 YYYY-MM。' });
      return sendJson(res, 200, { dates: await listArchive(month) });
    }
    const dailyFile = requestUrl.pathname.match(/^\/outputs\/vibe-coding-daily-brew\/daily\/(latest|\d{4}-\d{2}-\d{2})\.json$/);
    if (dailyFile && req.method === 'GET') {
      try {
        const content = await readFile(path.join(DAILY_DIR, `${dailyFile[1]}.json`));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': content.byteLength, 'Cache-Control': 'no-store' });
        return res.end(content);
      } catch (error) { if (error.code === 'ENOENT') return sendJson(res, 404, { error: 'not_found' }); throw error; }
    }
    if (requestUrl.pathname === '/api/source-recommendations' && req.method === 'GET') {
      const query = (requestUrl.searchParams.get('query') || '').trim().slice(0, 160);
      const limit = Math.max(1, Math.min(10, Number(requestUrl.searchParams.get('limit')) || 10));
      const catalog = await readSourceCatalog();
      let sources = [...catalog.sources];
      let live = false;
      const localMatches = query.length >= 2 ? sources.filter(source => sourceMatchesQuery(source, query)).length : sources.length;
      if (query.length >= 2 && localMatches < 3) {
        const discovered = await discoverSources(query, { apiKey: config.OPENROUTER_API_KEY?.trim(), model: MODEL, limit: 5 });
        const knownUrls = new Set(sources.map(source => source.url.replace(/\/$/, '').toLowerCase()));
        for (const source of discovered) {
          const key = source.url.replace(/\/$/, '').toLowerCase();
          if (!knownUrls.has(key)) { sources.push(source); knownUrls.add(key); live = true; }
        }
      }
      return sendJson(res, 200, { query, sources: rankSources(sources, query, limit), live, ranking_version: SOURCE_RANKING_VERSION, catalog_version: catalog.catalogVersion, updated_at: catalog.updatedAt });
    }
    if (requestUrl.pathname === '/api/brew' && req.method === 'POST') {
      const body = JSON.parse(await readRequestBody(req) || '{}');
      const historicalDate = body.date ? normalizeTargetDate(body.date) : '';
      const count = historicalDate ? 10 : Number(body.count);
      if (!Number.isInteger(count) || count < 1 || count > 10) return sendJson(res, 400, { error: '篇數必須是 1 到 10 之間的整數。' });
      const preferences = sanitizePreferences(body.preferences);
      if (historicalDate) {
        try { return sendJson(res, 200, { edition: await readEdition(historicalDate), model: MODEL, reused: true }); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        const edition = createEdition(historicalDate, await brew(10, preferences, historicalDate));
        await writeEdition(historicalDate, edition);
        return sendJson(res, 200, { edition, model: MODEL, reused: false });
      }
      const items = await brew(count, preferences, localDate());
      return sendJson(res, 200, { items, model: MODEL });
    }
    if (req.method === 'GET' && (requestUrl.pathname === '/' || requestUrl.pathname === '/index.html')) return serveSite(res);
    return sendJson(res, 404, { error: 'not_found' });
  } catch (error) {
    const modelError = ['model_response_empty', 'model_response_error', 'model_json_missing', 'model_json_incomplete', 'model_items_missing', 'model_items_incomplete'].includes(error.message);
    const status = error.status || (isTimeoutError(error) ? 504 : error.message === 'request_too_large' ? 413 : error instanceof SyntaxError ? 400 : modelError ? 502 : 500);
    const message = error.message === 'request_too_large' ? '請求內容太大，請縮短偏好設定後再試。' : error.message === 'api_key_missing' ? '尚未設定 API key。請在 .env.local 設定 OPENROUTER_API_KEY。' : error.message === 'invalid_date' ? '日期格式無效，請使用 YYYY-MM-DD。' : error.message === 'future_date' ? '歷史手沖只能生成今天或更早的日期。' : error.message === 'source_after_as_of_date' ? '模型回傳了公示日期之後的來源，這一批沒有保存。' : publicErrorMessage(error);
    console.error(`Request failed: ${error.message}`);
    return sendJson(res, status, { error: message });
  }
});

server.listen(PORT, () => {
  console.log(`Vibe Coding 每日手沖 running at http://localhost:${PORT}`);
});
