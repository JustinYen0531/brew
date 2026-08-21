import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverSources, rankSources, readSourceCatalog, sourceMatchesQuery, SOURCE_RANKING_VERSION } from './source-catalog.mjs';
import { authApi } from './api/auth.mjs';
import { preferencesApi, sanitizePreferenceRecord } from './api/preferences.mjs';
import { profileApi } from './api/profile.mjs';
import { editionApi } from './api/edition.mjs';
import { editionsApi } from './api/editions.mjs';
import { feedbackApi } from './api/feedback.mjs';
import { pantryApi } from './api/pantry.mjs';
import { buildEditionRecipeResponse } from './api/edition-recipe.mjs';
import { buildMorningBrewPrompt, buildMorningBrewRecipeSnapshot, getMorningRecipe, publicMorningBrewCatalog } from './morning-brew-recipes.mjs';
import { getAuthorizedContext, readPersonalEdition, readPersonalRecommendationSignals, sanitizeStoredJson, savePersonalEdition } from './api/edition-storage.mjs';
import { filterAndRankCandidates } from './candidate-pool.mjs';
import { collectSourceCandidates } from './source-connectors.mjs';

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
const OPENROUTER_MODEL = config.OPENROUTER_MODEL || 'deepseek/deepseek-v4-flash-0731';
const OPENAI_MODEL = config.OPENAI_MODEL || 'gpt-5.4';
const DEFAULT_PROVIDER = config.BREW_PROVIDER || 'openrouter';
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENAI_API_URL = 'https://api.openai.com/v1/responses';
const CODEX_COMMAND = config.CODEX_COMMAND || 'codex';
const REQUEST_TIMEOUT_MS = 45_000;
const RETRY_TIMEOUT_MS = 30_000;
const CODEX_TIMEOUT_MS = 120_000;
const MAX_BREW_ATTEMPTS = 2;
const MAX_PARALLEL_BREWS = 2;
const DIFFICULTY_LEVELS = ['初學者', '普通', '困難'];
const BREW_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      minItems: 1,
      maxItems: 1,
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          category: { type: 'string' },
          tag: { type: 'string' },
          difficulty: { type: 'string', enum: DIFFICULTY_LEVELS },
          takeaway: { type: 'string' },
          problem: { type: 'string' },
          principle: { type: 'string' },
          try_it: { type: 'string' },
          tradeoffs: { type: 'string' },
          practice_prompt: { type: 'string' },
          source_says: { type: 'string' },
          editorial_synthesis: { type: 'string' },
          source: {
            type: 'object',
            properties: { url: { type: 'string' }, platform: { type: 'string' }, published_at: { type: 'string' } },
            required: ['url', 'platform', 'published_at'],
            additionalProperties: false
          },
          scores: {
            type: 'object',
            properties: { timeless: { type: 'number' }, importance: { type: 'number' }, popularity: { type: 'number' } },
            required: ['timeless', 'importance', 'popularity'],
            additionalProperties: false
          }
        },
        required: ['title', 'category', 'tag', 'difficulty', 'takeaway', 'problem', 'principle', 'try_it', 'tradeoffs', 'practice_prompt', 'source_says', 'editorial_synthesis', 'source', 'scores'],
        additionalProperties: false
      }
    }
  },
  required: ['items'],
  additionalProperties: false
};

const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

function normalizeProvider(value = DEFAULT_PROVIDER) {
  return ['openrouter', 'openai', 'codex'].includes(value) ? value : 'openrouter';
}

function modelForProvider(provider) {
  if (provider === 'openai') return OPENAI_MODEL;
  if (provider === 'codex') return 'Codex · ChatGPT 訂閱（本機）';
  return OPENROUTER_MODEL;
}

function providerStatus() {
  return {
    default: normalizeProvider(DEFAULT_PROVIDER),
    openrouter: { configured: Boolean(config.OPENROUTER_API_KEY?.trim()), model: OPENROUTER_MODEL },
    openai: { configured: Boolean(config.OPENAI_API_KEY?.trim()), model: OPENAI_MODEL },
    codex: { enabled: config.CODEX_ENABLED !== 'false', command: CODEX_COMMAND, localOnly: true }
  };
}

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

function normalizeDifficulty(value) {
  return DIFFICULTY_LEVELS.includes(value) ? value : '普通';
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
  raw = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const profile = sanitizePreferenceRecord(raw);
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
  const feedbackSignals = Array.isArray(raw.feedbackSignals) ? raw.feedbackSignals.slice(0, 100).map(signal => sanitizeStoredJson(signal)).filter(Boolean) : [];
  return {
    ...profile,
    recipeId: profile.recipe_id,
    editorialTone: profile.editorial_tone,
    brewMethod: profile.brew_method,
    topics: profile.topics,
    excludedTopics: profile.excluded_topics,
    contentStyles: profile.content_styles,
    sourceLanes: profile.source_lanes,
    difficultyLevels: profile.difficulty_levels,
    readingMinutes: profile.reading_minutes,
    itemCount: profile.item_count,
    noveltyLevel: profile.novelty_level,
    reviewEnabled: profile.review_enabled,
    onboardingCompleted: profile.onboarding_completed,
    sourceLanguage: profile.source_language,
    outputLanguage: profile.output_language,
    topicWeights: profile.topic_weights,
    blendRatios: profile.blend_ratios,
    timezone: profile.timezone,
    morningTime: profile.morning_time,
    selectedSourceIds: profile.selected_source_ids,
    sourceWeights: profile.source_weights,
    specificSources: profile.specific_sources,
    directUrls: profile.direct_urls,
    sourcePrompt: profile.source_prompt,
    sourceWeights,
    specificSources,
    selectedSources,
    customSources,
    prompt: typeof raw.prompt === 'string' ? raw.prompt.trim().slice(0, 1000) : '',
    directUrls,
    language: profile.output_language,
    feedbackSignals
  };
}

function preferenceBrief(preferences) {
  const language = preferences.language === 'en' ? 'English' : '繁體中文';
  const weightedSources = Object.entries(preferences.sourceWeights).map(([source, weight]) => `${source}=${weight}/5`).join('、');
  const specificSources = Object.entries(preferences.specificSources).filter(([, value]) => value).map(([source, value]) => `${source}: ${value}`).join('；') || '沒有指定特定社群';
  const selectedSources = [...(preferences.selectedSources || []), ...(preferences.customSources || [])].map(source => `${source.name || source.platform || '未命名來源'} <${source.url}>`).join('；') || '尚未選取來源';
  const directSources = preferences.directUrls.length ? preferences.directUrls.join('\n') : '沒有硬性網址限制';
  const topics = preferences.topics?.join('、') || '尚未指定主題';
  const excludedTopics = preferences.excludedTopics?.join('、') || '沒有排除主題';
  const contentStyles = preferences.contentStyles?.join('、') || '未指定內容形式';
  const sourceLanes = preferences.sourceLanes?.join('、') || '未指定來源路徑';
  const difficultyLevels = preferences.difficultyLevels?.join('、') || '普通';
  const topicWeights = Object.entries(preferences.topicWeights || {}).map(([topic, weight]) => `${topic}=${weight}/5`).join('、') || '尚未調整主題權重';
  const blend = preferences.blendRatios || { new_discoveries: 60, saved_reviews: 20, classic: 10, surprise: 10 };
  const blendText = `新發現 ${blend.new_discoveries}%／收藏複習 ${blend.saved_reviews}%／經典 ${blend.classic}%／意外驚喜 ${blend.surprise}%`;
  const outputLanguage = preferences.outputLanguage === 'en' ? 'English' : '繁體中文';
  return `\n\n【使用者的晨報配方】\n想讀的主題：${topics}\n主題權重：${topicWeights}\n暫時避開的主題：${excludedTopics}\n偏好的內容形式：${contentStyles}\n偏好的來源路徑：${sourceLanes}\n難度：${difficultyLevels}\n閱讀時間：${preferences.readingMinutes} 分鐘；希望篇數：${preferences.itemCount} 篇；新鮮感：${preferences.noveltyLevel}/5；複習：${preferences.reviewEnabled ? '開啟' : '關閉'}\n晨報比例：${blendText}；取整時維持本次實際篇數，不可自行增減。\n偏好早晨：${preferences.timezone} ${preferences.morningTime}\n\n【來源偏好】\n資訊源頭語言偏好：${language}\n最後整理語言：${outputLanguage}\n來源機率權重：${weightedSources}\n來源資料庫中使用者選取的提供者：${selectedSources}\n特定社群偏好（prompt 提示）：${specificSources}\n額外 prompt：${preferences.prompt || '沒有額外 prompt'}\n硬性網址來源（若有，只能從這些網址或其頁面翻找）：\n${directSources}\n請嚴格區分「來源推薦／偏好」與「硬性網址」：偏好是排序訊號；硬性網址是來源限制。不要因為某來源被選取，就降低來源證據與日期驗證標準。`;
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

function buildSearchPlugin(preferences, compact) {
  const plugin = {
    id: 'web',
    engine: 'exa',
    mode: 'instant',
    max_results: 1,
    search_prompt: '請把搜尋結果當作證據使用；不要輸出 Markdown 連結或額外說明，只回傳使用者要求的 JSON object。'
  };
  const domains = allowedSearchDomains(preferences);
  if (domains.length) plugin.include_domains = domains;
  return plugin;
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

async function readJsonBody(req) {
  const raw = await readRequestBody(req);
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); }
  catch { throw Object.assign(new Error('invalid_json'), { status: 400 }); }
}

function sendApiResult(res, result) {
  const headers = { ...jsonHeaders, ...(result.headers || {}) };
  res.writeHead(result.status, headers);
  if (result.body === undefined) return res.end();
  return res.end(JSON.stringify(result.body));
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(part => extractText(part)).join('');
  if (content && typeof content.text === 'string') return content.text;
  if (content && typeof content.output_text === 'string') return content.output_text;
  if (content && typeof content.content === 'string') return content.content;
  if (content && typeof content.json === 'string') return content.json;
  if (content?.json && typeof content.json === 'object') return JSON.stringify(content.json);
  if (content && typeof content === 'object') return JSON.stringify(content);
  return '';
}

function extractOpenAIText(payload) {
  if (typeof payload?.output_text === 'string') return payload.output_text;
  const parts = (payload?.output || []).flatMap(item => Array.isArray(item?.content) ? item.content : []);
  return parts.filter(part => part?.type === 'output_text').map(part => part.text || '').join('');
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
  const required = ['title', 'category', 'takeaway', 'problem', 'principle', 'try_it', 'tradeoffs', 'practice_prompt', 'source_says', 'editorial_synthesis'];
  const items = payload.items.slice(0, count).filter(item => required.every(key => typeof item?.[key] === 'string' && item[key].trim()));
  if (items.length !== count) throw new Error('model_items_incomplete');
  return items.map((item, index) => {
    const source = item.source && typeof item.source === 'object' ? item.source : {};
    const url = typeof source.url === 'string' && /^https?:\/\//i.test(source.url) ? source.url.trim() : '';
    const publishedAt = dateOnly(source.published_at);
    if (!url || !source.platform?.trim() || !publishedAt || publishedAt > asOfDate || /^(unknown|unavailable|n\/a|無法取得|未提供)$/i.test(item.source_says.trim())) {
      throw new Error('source_metadata_invalid');
    }
    return {
      n: String(index + 1).padStart(2, '0'),
      category: item.category.trim(),
      tag: item.tag || '即時選集',
      difficulty: normalizeDifficulty(item.difficulty),
      title: item.title.trim(),
      takeaway: item.takeaway.trim(),
      timeless: clamp(item.scores?.timeless, 1, 5, 3),
      importance: clamp(item.scores?.importance, 1, 5, 3),
      heat: clamp(item.scores?.popularity, 1, 5, 2),
      time: item.time || '6 分鐘',
      source: source.platform ? `${source.platform} · 即時來源` : '即時社群來源',
      sourceType: source.platform || '社群討論',
      date: publishedAt,
      classic: false,
      problem: item.problem.trim(),
      principle: item.principle.trim(),
      tryIt: item.try_it.trim(),
      tradeoffs: item.tradeoffs.trim(),
      prompt: item.practice_prompt.trim(),
      evidence: item.source_says.trim(),
      url
    };
  });
  return items;
}

function buildPrompt(count, preferences, asOfDate) {
  return `資料截點是 ${asOfDate}。這一壺晨報本次實際必須產出 ${count} 篇，不能多也不能少。請使用可用的 web search，找出在 ${asOfDate} 當天或之前已經存在的、與 Vibe Coding 相關、具體且可重複的實作方法，並整理成繁體中文學習內容。嚴格禁止使用 ${asOfDate} 之後發布、更新或發生的發現，所有 source.published_at 必須小於或等於 ${asOfDate}。不要做產品新聞、模型發布摘要或空泛金句。每篇都必須說明問題、可轉移原則、可操作範例、限制、練習題與來源證據。${preferenceBrief(preferences)}\n\n晨報內容配方請以 60% 新發現、20% 收藏複習、10% 經典、10% 意外驚喜作方向；當實際 count 為 10 時，具體安排為 6／2／1／1。其他 count 請依比例取整並維持恰好 ${count} 篇。複習與經典內容必須來自可驗證的既有材料；若當次沒有足夠候選，請用可重讀的新發現補位，不要捏造收藏狀態。難度請依先備知識與實作風險判定：初學者＝具備基本閱讀與提問能力即可嘗試；普通＝需要基本程式碼、repository 或測試經驗；困難＝需要多步驟整合、架構／權限／部署判斷，或實際操作後才能安全掌握。請只回傳 JSON object，不要 Markdown，不要前言，格式必須是：\n{"items":[{"title":"...","category":"思考|提示設計|Agent 管理|上下文工程|程式碼理解|驗證|工作流程|工藝與心態|安全|協作|學習系統","tag":"新鮮實作|近期耐用|舊作高價值","difficulty":"初學者|普通|困難","takeaway":"...","problem":"...","principle":"...","try_it":"...","tradeoffs":"...","practice_prompt":"...","source_says":"...","editorial_synthesis":"...","source":{"url":"https://...","platform":"...","author":"...","published_at":"YYYY-MM-DD","evidence_excerpt":"...","popularity_basis":"..."},"scores":{"timeless":1,"importance":1,"popularity":1}}]}\n\n評分必須是 1 到 5 的數字。來源 URL、作者、日期與證據不確定時，請如實降低評分或排除，不要捏造。`;
}

function buildRequestPrompt(count, preferences, asOfDate, compact = false, slot = 0, batchCount = count) {
  const prompt = buildMorningBrewPrompt(batchCount, preferences, asOfDate);
  const diversity = count === 1 ? `\n\n這是同一批中的第 ${slot + 1} 個獨立發現，請選擇與其他發現不同的實作主題，不要重複常見金句。` : '';
  const retry = compact ? `\n\n這是重試版本：每個欄位只寫 1 到 2 句，整篇控制在約 350 個中文字內，務必只完成這 1 篇。` : '';
  return `${prompt}${diversity}${retry}\n\n輸出欄位以 API 的 JSON Schema 為最高優先；source 只保留 url、platform、published_at，items 必須恰好包含 1 篇。`;
}

async function requestOpenRouter(key, count, preferences, asOfDate, attempt, slot = 0, batchCount = count) {
  const compact = attempt > 0;
  const responseFormat = compact
    ? { type: 'json_object' }
    : { type: 'json_schema', json_schema: { name: 'vibe_coding_brew', strict: true, schema: BREW_RESPONSE_SCHEMA } };
  const upstream = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': `http://localhost:${PORT}`,
      'X-Title': 'Vibe Coding Daily Brew'
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: 'system', content: '你是 Vibe Coding Daily Brew 的嚴謹中文編輯。只保留有證據、可轉移、可實作的做法。' },
        { role: 'user', content: buildRequestPrompt(count, preferences, asOfDate, compact, slot, batchCount) }
      ],
      temperature: compact ? 0.15 : 0.25,
      max_tokens: compact ? 2200 : 2400,
      reasoning: { effort: 'none', exclude: true },
      provider: { allow_fallbacks: true },
      plugins: [buildSearchPlugin(preferences, compact), { id: 'response-healing' }],
      ...(responseFormat ? { response_format: responseFormat } : {})
    }),
    signal: AbortSignal.timeout(compact ? RETRY_TIMEOUT_MS : REQUEST_TIMEOUT_MS)
  });
  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    console.error(`OpenRouter request failed: HTTP ${upstream.status}`);
    throw Object.assign(new Error('upstream_failed'), { status: 502, upstreamStatus: upstream.status });
  }
  const choice = data.choices?.[0] || {};
  const modelError = data.error || choice.error;
  if (modelError) {
    console.error(`OpenRouter model response failed: ${modelError.code || modelError.message || 'unknown'}`);
    throw Object.assign(new Error('model_response_error'), { status: 502 });
  }
  const answer = extractText(choice.message?.content);
  return normalizeItems(parseJsonAnswer(answer), count, asOfDate);
}

async function requestOpenAI(key, count, preferences, asOfDate, attempt, slot = 0, batchCount = count) {
  const compact = attempt > 0;
  const domains = allowedSearchDomains(preferences);
  const upstream = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions: '你是 Vibe Coding Daily Brew 的嚴謹中文編輯。只保留有證據、可轉移、可實作的做法。',
      input: buildRequestPrompt(count, preferences, asOfDate, compact, slot, batchCount),
      tools: [{ type: 'web_search_preview', ...(domains.length ? { filters: { allowed_domains: domains } } : {}) }],
      max_output_tokens: compact ? 2200 : 2400,
      text: { format: { type: 'json_schema', name: 'vibe_coding_brew', strict: true, schema: BREW_RESPONSE_SCHEMA } }
    }),
    signal: AbortSignal.timeout(compact ? RETRY_TIMEOUT_MS : REQUEST_TIMEOUT_MS)
  });
  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok || data.error) {
    console.error(`OpenAI request failed: HTTP ${upstream.status || 502}`);
    throw Object.assign(new Error('upstream_failed'), { status: 502, upstreamStatus: upstream.status });
  }
  return normalizeItems(parseJsonAnswer(extractOpenAIText(data)), count, asOfDate);
}

function runLocalCodex(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn(CODEX_COMMAND, ['exec', '--ephemeral', prompt], {
      cwd: ROOT,
      env: process.env,
      shell: process.platform === 'win32',
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(Object.assign(new Error('codex_timeout'), { status: 504 }));
    }, CODEX_TIMEOUT_MS);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => {
      clearTimeout(timer);
      console.error(`Codex bridge failed to start: ${error.message}`);
      reject(Object.assign(new Error('codex_not_installed'), { status: 503 }));
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) {
        console.error(`Codex bridge exited with ${code}: ${stderr.trim().slice(-500)}`);
        reject(Object.assign(new Error('codex_failed'), { status: 502 }));
        return;
      }
      resolve(stdout);
    });
  });
}

async function requestCodex(count, preferences, asOfDate, attempt, slot = 0, batchCount = count) {
  const answer = await runLocalCodex(buildRequestPrompt(count, preferences, asOfDate, attempt > 0, slot, batchCount));
  return normalizeItems(parseJsonAnswer(answer), count, asOfDate);
}

async function requestUpstream(key, count, preferences, asOfDate, attempt, slot = 0, provider = DEFAULT_PROVIDER, batchCount = count) {
  if (provider === 'openai') return requestOpenAI(key, count, preferences, asOfDate, attempt, slot, batchCount);
  if (provider === 'codex') return requestCodex(count, preferences, asOfDate, attempt, slot, batchCount);
  return requestOpenRouter(key, count, preferences, asOfDate, attempt, slot, batchCount);
}

function isTimeoutError(error) {
  return error?.name === 'TimeoutError' || error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
}

function isRetryableModelError(error) {
  return ['model_response_empty', 'model_response_error', 'model_json_missing', 'model_json_incomplete', 'model_items_missing', 'model_items_incomplete', 'source_metadata_invalid'].includes(error?.message);
}

function publicErrorMessage(error) {
  if (error.message === 'api_key_missing') return '尚未設定 OpenRouter API key。請在 .env.local 設定 OPENROUTER_API_KEY。';
  if (error.message === 'openai_api_key_missing') return '尚未設定 OpenAI API key。請在 .env.local 設定 OPENAI_API_KEY。';
  if (error.message === 'codex_local_only') return '本機 Codex 只能由本機 server.mjs 執行，不能由雲端函式代跑。';
  if (error.message === 'codex_not_installed') return '找不到本機 Codex CLI；請先安裝並執行 codex login。';
  if (error.message === 'codex_failed') return '本機 Codex 執行失敗；請確認已完成 codex login，並查看本機終端機訊息。';
  if (error.message === 'codex_timeout') return '本機 Codex 執行逾時，請稍後再試。';
  if (isTimeoutError(error)) return '即時搜尋逾時，請稍後再試；若一次篇數較多，可先改成 3 篇。';
  if (['model_response_empty', 'model_response_error', 'model_json_missing', 'model_json_incomplete', 'model_items_missing', 'model_items_incomplete', 'source_metadata_invalid'].includes(error.message)) return '模型回覆缺少可驗證的來源日期、網址或證據，請稍後再試。';
  if (error.message === 'candidate_pool_insufficient') return '這一批可驗證的候選內容不足，請稍後再試。';
  if (error.message === 'upstream_failed') return '即時來源暫時無法回應，請稍後再試。';
  return '手沖服務暫時無法使用。';
}

async function requestWithRetry(key, preferences, asOfDate, slot, provider, batchCount) {
  let lastError;
  for (let attempt = 0; attempt < MAX_BREW_ATTEMPTS; attempt += 1) {
    try {
      return await requestUpstream(key, 1, preferences, asOfDate, attempt, slot, provider, batchCount);
    } catch (error) {
      lastError = error;
      if (attempt + 1 >= MAX_BREW_ATTEMPTS || !isRetryableModelError(error)) throw error;
      console.error(`Retrying brew after ${error.message}`);
    }
  }
  throw lastError;
}

async function mapConcurrent(count, task, concurrency = MAX_PARALLEL_BREWS) {
  const results = Array(count);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= count) return;
      results[index] = await task(index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(count, concurrency) }, () => worker()));
  return results.flat();
}

async function brew(count, preferences, asOfDate, provider = DEFAULT_PROVIDER, requestApiKey = '') {
  const selectedProvider = normalizeProvider(provider);
  const providedKey = typeof requestApiKey === 'string' ? requestApiKey.trim().slice(0, 512) : '';
  const configuredKey = selectedProvider === 'openai' ? config.OPENAI_API_KEY?.trim() : config.OPENROUTER_API_KEY?.trim();
  if (selectedProvider === 'openrouter' && !providedKey && !configuredKey) throw Object.assign(new Error('api_key_missing'), { status: 503 });
  if (selectedProvider === 'openai' && !providedKey && !configuredKey) throw Object.assign(new Error('openai_api_key_missing'), { status: 503 });
  if (selectedProvider === 'codex' && process.env.VERCEL) throw Object.assign(new Error('codex_local_only'), { status: 503 });
  const key = providedKey || configuredKey;
  const sourceCollection = await collectSourceCandidates(preferences, asOfDate);
  const requestPreferences = { ...preferences, sourceCandidates: sourceCollection.candidates };
  const items = await mapConcurrent(count, slot => requestWithRetry(key, requestPreferences, asOfDate, slot, selectedProvider, count));
  const ranked = filterAndRankCandidates(items, preferences, asOfDate, { count });
  ranked.snapshot = { ...ranked.snapshot, source_collection: sourceCollection.snapshot };
  return ranked;
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
    return {
      date,
      count: Array.isArray(edition.items) ? edition.items.length : 0,
      generated_at: edition.generated_at || '',
      mode: edition.mode || 'daily',
      has_recipe: Boolean(edition.generation_recipe),
      recipe_version: edition.generation_recipe?.schema_version || '',
      generation_run_id: edition.generation_run_id || ''
    };
  }));
}

function buildEditionRecipeSnapshot(date, itemCount, mode, provider, preferences = {}, candidatePool = null) {
  const recipe = getMorningRecipe(preferences.recipeId || preferences.recipe_id);
  const recipePreferences = {
    recipeId: recipe.id,
    editorialTone: preferences.editorialTone || preferences.editorial_tone || 'hands-on-editor',
    brewMethod: preferences.brewMethod || preferences.brew_method || 'daily-pour',
    topics: preferences.topics?.length ? preferences.topics : recipe.topics,
    excludedTopics: preferences.excludedTopics?.length ? preferences.excludedTopics : recipe.excludedTopics,
    contentStyles: preferences.contentStyles?.length ? preferences.contentStyles : recipe.defaultContentStyles,
    sourceLanes: preferences.sourceLanes?.length ? preferences.sourceLanes : recipe.sourceLanes,
    difficultyLevels: preferences.difficultyLevels?.length ? preferences.difficultyLevels : ['普通'],
    readingMinutes: preferences.readingMinutes || 10,
    itemCount,
    noveltyLevel: preferences.noveltyLevel || 3,
    reviewEnabled: preferences.reviewEnabled !== false,
    sourceLanguage: preferences.sourceLanguage || 'zh-Hant',
    outputLanguage: preferences.outputLanguage || 'zh-Hant',
    selectedSourceIds: preferences.selectedSourceIds?.length ? preferences.selectedSourceIds : recipe.sourceIds,
    sourceWeights: preferences.sourceWeights || {},
    topicWeights: preferences.topicWeights || {},
    blendRatios: preferences.blendRatios || { new_discoveries: 60, saved_reviews: 20, classic: 10, surprise: 10 },
    timezone: preferences.timezone || 'Asia/Taipei',
    morningTime: preferences.morningTime || '07:00',
    specificSources: preferences.specificSources || {},
    directUrls: preferences.directUrls || [],
    sourcePrompt: preferences.sourcePrompt || preferences.prompt || '',
    prompt: preferences.prompt || '',
    selectedSources: preferences.selectedSources || [],
    customSources: preferences.customSources || []
  };
  const selectedProvider = normalizeProvider(provider);
  return {
    schema_version: 'live-recipe-v1',
    kind: mode === 'daily' ? 'automatic_daily_brew' : 'manual_brew',
    run_date: date,
    as_of_date: date,
    preferences: {
      recipe_id: recipePreferences.recipeId,
      editorial_tone: recipePreferences.editorialTone,
      brew_method: recipePreferences.brewMethod,
      source_language: recipePreferences.sourceLanguage,
      output_language: recipePreferences.outputLanguage,
      selected_source_ids: recipePreferences.selectedSourceIds,
      source_weights: recipePreferences.sourceWeights,
      topic_weights: recipePreferences.topicWeights,
      blend_ratios: recipePreferences.blendRatios,
      timezone: recipePreferences.timezone,
      morning_time: recipePreferences.morningTime,
      specific_sources: recipePreferences.specificSources,
      direct_urls: recipePreferences.directUrls,
      source_prompt: recipePreferences.sourcePrompt,
      topics: recipePreferences.topics,
      excluded_topics: recipePreferences.excludedTopics,
      content_styles: recipePreferences.contentStyles,
      source_lanes: recipePreferences.sourceLanes,
      difficulty_levels: recipePreferences.difficultyLevels,
      language: recipePreferences.outputLanguage,
      item_count: itemCount,
      novelty_level: recipePreferences.noveltyLevel,
      review_enabled: recipePreferences.reviewEnabled,
      blend: recipePreferences.blendRatios
    },
    prompt: {
      version: 'live-prompt-v1',
      system: '你是 Vibe Coding Daily Brew 的嚴謹中文編輯。只保留有證據、可轉移、可實作的做法。',
      text: buildMorningBrewPrompt(itemCount, recipePreferences, date)
    },
    model: { provider: selectedProvider, name: modelForProvider(selectedProvider), generation_method: selectedProvider === 'codex' ? 'local_codex_exec' : 'provider_api' },
    search_rules: {
      version: 'live-search-v1',
      web_search_required: true,
      allowed_source_date_lte: date,
      canonical_url_required: true,
      evidence_required: true
    },
    candidate_pool: candidatePool || null
  };
}

function createEdition(date, items, mode = 'historical', provider = DEFAULT_PROVIDER, preferences = {}, candidatePool = null) {
  const selectedProvider = normalizeProvider(provider);
  return {
    run_date: date,
    mode,
    provider: selectedProvider,
    model: modelForProvider(selectedProvider),
    requested_count: items.length,
    title: 'Vibe Coding 每日手沖',
    objective: mode === 'historical'
      ? `模擬網站在 ${date} 當天已存在時，從當時可見的發現中手沖十份可驗證、可轉移的 Vibe Coding 做法。`
      : '從當前社群討論中挑出十個可驗證、可轉移、值得留下的 Vibe Coding 做法。',
    generated_at: new Date().toISOString(),
    generation_recipe: buildEditionRecipeSnapshot(date, items.length, mode, selectedProvider, preferences, candidatePool),
    items
  };
}

const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (requestUrl.pathname === '/api/health' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, providers: providerStatus() });
    }
    if (requestUrl.pathname === '/api/auth' && ['GET', 'POST', 'OPTIONS'].includes(req.method)) {
      const body = req.method === 'POST' ? await readJsonBody(req) : {};
      return sendApiResult(res, await authApi({ method: req.method, headers: req.headers, url: req.url, body, env: config }));
    }
    if (requestUrl.pathname === '/api/preferences' && ['GET', 'PUT', 'OPTIONS'].includes(req.method)) {
      const body = req.method === 'PUT' ? await readJsonBody(req) : {};
      return sendApiResult(res, await preferencesApi({ method: req.method, headers: req.headers, url: req.url, body, env: config }));
    }
    if (requestUrl.pathname === '/api/profile' && ['GET', 'PUT', 'OPTIONS'].includes(req.method)) {
      const body = req.method === 'PUT' ? await readJsonBody(req) : {};
      return sendApiResult(res, await profileApi({ method: req.method, headers: req.headers, url: req.url, body, env: config }));
    }
    if (requestUrl.pathname === '/api/edition' && ['GET', 'OPTIONS'].includes(req.method)) {
      return sendApiResult(res, await editionApi({ method: req.method, headers: req.headers, url: req.url, env: config }));
    }
    if (requestUrl.pathname === '/api/editions' && ['GET', 'OPTIONS'].includes(req.method)) {
      return sendApiResult(res, await editionsApi({ method: req.method, headers: req.headers, url: req.url, env: config }));
    }
    if (requestUrl.pathname === '/api/feedback' && ['GET', 'POST', 'OPTIONS'].includes(req.method)) {
      const body = req.method === 'POST' ? await readJsonBody(req) : {};
      return sendApiResult(res, await feedbackApi({ method: req.method, headers: req.headers, url: req.url, body, env: config }));
    }
    if (requestUrl.pathname === '/api/pantry' && ['GET', 'OPTIONS'].includes(req.method)) {
      return sendApiResult(res, await pantryApi({ method: req.method, headers: req.headers, url: req.url, env: config }));
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
    if (requestUrl.pathname === '/api/edition-recipe' && req.method === 'GET') {
      const requestedDate = requestUrl.searchParams.get('date') || 'latest';
      const date = requestedDate === 'latest' ? 'latest' : normalizeTargetDate(requestedDate);
      try {
        const payload = buildEditionRecipeResponse(await readEdition(date));
        if (!payload) return sendJson(res, 404, { error: '這一期沒有保存可公開的自動日報配方。' });
        return sendJson(res, 200, payload);
      } catch (error) {
        if (error.code === 'ENOENT') return sendJson(res, 404, { error: '找不到這一天的日報配方。' });
        throw error;
      }
    }
    if (requestUrl.pathname === '/api/recipe-catalog' && req.method === 'GET') {
      return sendJson(res, 200, publicMorningBrewCatalog());
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
      const recipe = getMorningRecipe(requestUrl.searchParams.get('recipe_id') || requestUrl.searchParams.get('recipeId'));
      const recipeSourceIds = new Set(recipe.sourceIds || []);
      const scopedCatalog = catalog.sources.filter(source => recipeSourceIds.has(source.id));
      const localSources = query.length >= 2 ? scopedCatalog.filter(source => sourceMatchesQuery(source, query)) : [...scopedCatalog];
      let sources = localSources;
      let live = false;
      const localMatches = localSources.length;
      if (query.length >= 2 && localMatches < 3) {
        const requestedProvider = normalizeProvider(requestUrl.searchParams.get('provider') || DEFAULT_PROVIDER);
        const liveProvider = requestedProvider === 'codex' ? '' : requestedProvider;
        const liveKey = liveProvider === 'openai' ? config.OPENAI_API_KEY?.trim() : config.OPENROUTER_API_KEY?.trim();
        const liveModel = liveProvider === 'openai' ? OPENAI_MODEL : OPENROUTER_MODEL;
        const discovered = liveProvider ? await discoverSources(query, { apiKey: liveKey, model: liveModel, provider: liveProvider, limit: 5 }) : [];
        const knownUrls = new Set(sources.map(source => source.url.replace(/\/$/, '').toLowerCase()));
        for (const source of discovered) {
          const key = source.url.replace(/\/$/, '').toLowerCase();
          if (!knownUrls.has(key)) { sources.push(source); knownUrls.add(key); live = true; }
        }
      }
      return sendJson(res, 200, { query, recipe_id: recipe.id, sources: rankSources(sources, query, limit), catalog_sources: scopedCatalog, live, ranking_version: SOURCE_RANKING_VERSION, catalog_version: catalog.catalogVersion, updated_at: catalog.updatedAt });
    }
    if (requestUrl.pathname === '/api/brew' && req.method === 'POST') {
      const body = JSON.parse(await readRequestBody(req) || '{}');
      const historicalDate = body.date ? normalizeTargetDate(body.date) : '';
      const preferences = sanitizePreferences(body.preferences);
      const count = historicalDate ? 10 : Number(body.count ?? preferences.itemCount);
      const provider = normalizeProvider(body.provider || body.preferences?.provider || DEFAULT_PROVIDER);
      const requestApiKey = typeof body.apiKey === 'string' ? body.apiKey.trim().slice(0, 512) : '';
      if (!Number.isInteger(count) || count < 1 || count > 15) return sendJson(res, 400, { error: '篇數必須是 1 到 15 之間的整數。' });
      const kind = historicalDate ? 'historical' : body.kind === 'manual' ? 'manual' : 'daily';
      const authorization = req.headers?.authorization || req.headers?.Authorization || '';
      const personalContext = authorization ? await getAuthorizedContext({ headers: req.headers, url: req.url, env: config }) : null;
      const asOfDate = historicalDate || localDate();
      if (personalContext && kind === 'daily') {
        const existing = await readPersonalEdition(personalContext, { date: asOfDate, kind: 'daily', potNumber: 1 });
        if (existing) return sendJson(res, 200, { items: existing.items, edition: existing, model: existing.model, provider: existing.provider, persisted: true, reused: true });
      }
      if (personalContext) {
        try {
          preferences.feedbackSignals = await readPersonalRecommendationSignals(personalContext);
        } catch (error) {
          return sendJson(res, error.status || 502, { error: error.safeMessage || '晨報回饋暫時無法讀取，請稍後再試。' });
        }
      }
      if (historicalDate) {
        if (!personalContext) {
          try {
            const edition = await readEdition(historicalDate);
            return sendJson(res, 200, { edition, model: edition.model || modelForProvider(edition.provider || provider), provider: edition.provider || provider, reused: true });
          }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
      }
      const brewed = await brew(historicalDate ? 10 : count, preferences, asOfDate, provider, requestApiKey);
      const items = brewed.items;
      const candidatePool = brewed.snapshot;
      if (personalContext) {
        const generatedAt = new Date().toISOString();
        const edition = await savePersonalEdition(personalContext, {
          kind,
          runDate: asOfDate,
          asOfDate,
          provider,
          model: modelForProvider(provider),
          title: 'Vibe Coding 每日手沖',
          objective: kind === 'historical'
            ? `從 ${asOfDate} 當時可見的發現中，保存一壺可驗證、可轉移的晨報。`
            : '從當前社群討論中挑出值得留下、可以理解也可以實作的晨報內容。',
          generatedAt,
          generationRecipe: buildMorningBrewRecipeSnapshot({ date: asOfDate, itemCount: items.length, kind, provider, model: modelForProvider(provider), preferences, candidatePool }),
          items
        });
        return sendJson(res, 200, { items: edition.items, edition, model: edition.model, provider, persisted: true, reused: false });
      }
      if (historicalDate) {
        const edition = createEdition(historicalDate, items, 'historical', provider, preferences, candidatePool);
        await writeEdition(historicalDate, edition);
        return sendJson(res, 200, { edition, model: edition.model, provider, reused: false });
      }
      return sendJson(res, 200, { items, model: modelForProvider(provider), provider, candidate_pool: candidatePool });
    }
    if (req.method === 'GET' && (requestUrl.pathname === '/' || requestUrl.pathname === '/index.html')) return serveSite(res);
    return sendJson(res, 404, { error: 'not_found' });
  } catch (error) {
    const modelError = ['model_response_empty', 'model_response_error', 'model_json_missing', 'model_json_incomplete', 'model_items_missing', 'model_items_incomplete', 'source_metadata_invalid'].includes(error.message);
    const status = error.status || (isTimeoutError(error) ? 504 : error.message === 'request_too_large' ? 413 : error instanceof SyntaxError ? 400 : modelError ? 502 : 500);
    const message = error.message === 'request_too_large' ? '請求內容太大，請縮短偏好設定後再試。' : error.message === 'invalid_json' ? '請傳送有效的 JSON。' : error.message === 'invalid_date' ? '日期格式無效，請使用 YYYY-MM-DD。' : error.message === 'future_date' ? '歷史手沖只能生成今天或更早的日期。' : error.message === 'source_after_as_of_date' ? '模型回傳了公示日期之後的來源，這一批沒有保存。' : publicErrorMessage(error);
    console.error(`Request failed: ${error.message}`);
    return sendJson(res, status, { error: message });
  }
});

server.listen(PORT, () => {
  console.log(`Vibe Coding 每日手沖 running at http://localhost:${PORT}`);
});
