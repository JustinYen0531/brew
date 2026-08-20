const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v4-flash-0731';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.4';
const DEFAULT_PROVIDER = process.env.BREW_PROVIDER || 'openrouter';
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENAI_API_URL = 'https://api.openai.com/v1/responses';
const REQUEST_TIMEOUT_MS = 45_000;
const RETRY_TIMEOUT_MS = 30_000;
const MAX_BREW_ATTEMPTS = 2;
const MAX_PARALLEL_BREWS = 2;
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
        required: ['title', 'category', 'tag', 'takeaway', 'problem', 'principle', 'try_it', 'tradeoffs', 'practice_prompt', 'source_says', 'editorial_synthesis', 'source', 'scores'],
        additionalProperties: false
      }
    }
  },
  required: ['items'],
  additionalProperties: false
};

function normalizeProvider(value = DEFAULT_PROVIDER) {
  return ['openrouter', 'openai', 'codex'].includes(value) ? value : 'openrouter';
}

function modelForProvider(provider) {
  if (provider === 'openai') return OPENAI_MODEL;
  if (provider === 'codex') return 'Codex · ChatGPT 訂閱（本機）';
  return OPENROUTER_MODEL;
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

function normalizeTargetDate(value) {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : localDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || dateOnly(`${raw}T00:00:00Z`) !== raw) throw Object.assign(new Error('invalid_date'), { status: 400 });
  if (raw > localDate()) throw Object.assign(new Error('future_date'), { status: 400 });
  return raw;
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function sanitizePreferences(raw = {}) {
  const sources = ['facebook', 'reddit', 'github'];
  const sourceWeights = Object.fromEntries(sources.map(source => [source, Math.round(clamp(raw.sourceWeights?.[source], 1, 5, 3))]));
  const specificSources = Object.fromEntries(sources.map(source => [source, typeof raw.specificSources?.[source] === 'string' ? raw.specificSources[source].trim().slice(0, 160) : '']));
  const normalizeProviders = (value, limit) => Array.isArray(value) ? value.filter(source => source && typeof source === 'object' && typeof source.url === 'string' && /^https?:\/\//i.test(source.url.trim())).slice(0, limit).map(source => ({
    id: typeof source.id === 'string' ? source.id.slice(0, 120) : '',
    name: typeof source.name === 'string' ? source.name.trim().slice(0, 160) : '',
    platform: typeof source.platform === 'string' ? source.platform.trim().slice(0, 80) : '',
    kind: typeof source.kind === 'string' ? source.kind.trim().slice(0, 100) : '',
    url: source.url.trim().slice(0, 500),
    evidence: typeof source.evidence === 'string' ? source.evidence.trim().slice(0, 320) : ''
  })) : [];
  const selectedSources = normalizeProviders(raw.selectedSources, 20);
  const customSources = normalizeProviders(raw.customSources, 10);
  const directUrls = Array.isArray(raw.directUrls) ? raw.directUrls.filter(url => typeof url === 'string' && /^https?:\/\//i.test(url.trim())).map(url => url.trim().slice(0, 500)).slice(0, 10) : [];
  return { sourceWeights, specificSources, selectedSources, customSources, prompt: typeof raw.prompt === 'string' ? raw.prompt.trim().slice(0, 1000) : '', directUrls, language: raw.language === 'en' ? 'en' : 'zh-Hant' };
}

function preferenceBrief(preferences) {
  const language = preferences.language === 'en' ? 'English' : '繁體中文';
  const weightedSources = Object.entries(preferences.sourceWeights).map(([source, weight]) => `${source}=${weight}/5`).join('、');
  const specificSources = Object.entries(preferences.specificSources).filter(([, value]) => value).map(([source, value]) => `${source}: ${value}`).join('；') || '沒有指定特定社群';
  const providerSources = [...(preferences.selectedSources || []), ...(preferences.customSources || [])].reduce((result, source) => {
    if (source.url && !result.some(item => item.url === source.url)) result.push(source);
    return result;
  }, []).map(source => `${source.name || source.platform || '未命名來源'} <${source.url}>`).join('；') || '尚未選取來源';
  const directSources = preferences.directUrls.length ? preferences.directUrls.join('\n') : '沒有硬性網址限制';
  return `\n\n【使用者本次偏好】\n資訊源頭語言偏好：${language}（最後整理仍請使用繁體中文）\n來源機率權重（1=盡量不要，3=正常，5=更多）：${weightedSources}\n來源資料庫中使用者選取的提供者：${providerSources}\n特定社群偏好（prompt 提示）：${specificSources}\n額外 prompt：${preferences.prompt || '沒有額外 prompt'}\n硬性網址來源（若有，只能從這些網址或其頁面翻找）：\n${directSources}\n請嚴格區分「來源推薦／偏好」與「硬性網址」：偏好是排序訊號；硬性網址是來源限制。不要因為某來源被選取，就降低來源證據與日期驗證標準。`;
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

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(part => typeof part === 'string' ? part : part?.text || '').join('');
  if (content && typeof content.text === 'string') return content.text;
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

function buildRequestPrompt(count, preferences, asOfDate, compact = false, slot = 0) {
  const prompt = buildPrompt(count, preferences, asOfDate);
  const diversity = count === 1 ? `\n\n這是同一批中的第 ${slot + 1} 個獨立發現，請選擇與其他發現不同的實作主題，不要重複常見金句。` : '';
  const retry = compact ? `\n\n這是重試版本：每個欄位只寫 1 到 2 句，整篇控制在約 350 個中文字內，務必只完成這 1 篇。` : '';
  return `${prompt}${diversity}${retry}\n\n輸出欄位以 API 的 JSON Schema 為最高優先；source 只保留 url、platform、published_at，items 必須恰好包含 1 篇。`;
}

function isTimeoutError(error) {
  return error?.name === 'TimeoutError' || error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
}

function isRetryableModelError(error) {
  return ['model_response_empty', 'model_response_error', 'model_json_missing', 'model_json_incomplete', 'model_items_missing', 'model_items_incomplete'].includes(error?.message);
}

function publicErrorMessage(error) {
  if (error.message === 'openai_api_key_missing') return 'Vercel 尚未設定 OPENAI_API_KEY。';
  if (error.message === 'codex_local_only') return '本機 Codex 只能由本機 server.mjs 執行，不能由 Vercel 代跑。';
  if (isTimeoutError(error)) return '即時搜尋逾時，請稍後再試；若一次篇數較多，可先改成 3 篇。';
  if (['model_response_empty', 'model_response_error', 'model_json_missing', 'model_json_incomplete', 'model_items_missing', 'model_items_incomplete'].includes(error.message)) return '模型回覆格式不完整，請稍後再試。';
  if (error.message === 'upstream_failed') return '即時來源暫時無法回應，請稍後再試。';
  return '手沖服務暫時無法使用，請稍後再試。';
}

async function requestOpenRouter(key, count, preferences, asOfDate, attempt, slot = 0) {
  const compact = attempt > 0;
  const upstream = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'X-Title': 'Vibe Coding Daily Brew'
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: 'system', content: '你是 Vibe Coding Daily Brew 的嚴謹中文編輯。只保留有證據、可轉移、可實作的做法。' },
        { role: 'user', content: buildRequestPrompt(count, preferences, asOfDate, compact, slot) }
      ],
      temperature: compact ? 0.15 : 0.25,
      max_tokens: compact ? 2200 : 2400,
      plugins: [buildSearchPlugin(preferences, compact), { id: 'response-healing' }],
      response_format: { type: 'json_schema', json_schema: { name: 'vibe_coding_brew', strict: true, schema: BREW_RESPONSE_SCHEMA } }
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

async function requestOpenAI(key, count, preferences, asOfDate, attempt, slot = 0) {
  const compact = attempt > 0;
  const domains = allowedSearchDomains(preferences);
  const upstream = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions: '你是 Vibe Coding Daily Brew 的嚴謹中文編輯。只保留有證據、可轉移、可實作的做法。',
      input: buildRequestPrompt(count, preferences, asOfDate, compact, slot),
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

async function requestUpstream(key, count, preferences, asOfDate, attempt, slot = 0, provider = DEFAULT_PROVIDER) {
  if (provider === 'openai') return requestOpenAI(key, count, preferences, asOfDate, attempt, slot);
  if (provider === 'codex') throw Object.assign(new Error('codex_local_only'), { status: 503 });
  return requestOpenRouter(key, count, preferences, asOfDate, attempt, slot);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: '只接受 POST 請求。' });
  const provider = normalizeProvider(req.body?.provider || req.body?.preferences?.provider || DEFAULT_PROVIDER);
  if (provider === 'codex') return res.status(503).json({ error: '本機 Codex 只能由本機 server.mjs 執行，不能由 Vercel 代跑。' });
  const key = provider === 'openai' ? process.env.OPENAI_API_KEY?.trim() : process.env.OPENROUTER_API_KEY?.trim();
  if (!key) return res.status(503).json({ error: provider === 'openai' ? 'Vercel 尚未設定 OPENAI_API_KEY。' : 'Vercel 尚未設定 OPENROUTER_API_KEY。' });

  let historicalDate = '';
  try { historicalDate = req.body?.date ? normalizeTargetDate(req.body.date) : ''; }
  catch (error) {
    const message = error.message === 'future_date' ? '歷史手沖只能生成今天或更早的日期。' : '日期格式無效，請使用 YYYY-MM-DD。';
    return res.status(error.status || 400).json({ error: message });
  }
  const count = historicalDate ? 10 : Number(req.body?.count);
  if (!Number.isInteger(count) || count < 1 || count > 10) return res.status(400).json({ error: '篇數必須是 1 到 10 之間的整數。' });
  const preferences = sanitizePreferences(req.body?.preferences);
  const asOfDate = historicalDate || localDate();

  try {
    async function requestWithRetry(slot) {
      let lastError;
      for (let attempt = 0; attempt < MAX_BREW_ATTEMPTS; attempt += 1) {
        try {
          return await requestUpstream(key, 1, preferences, asOfDate, attempt, slot, provider);
        } catch (error) {
          lastError = error;
          if (attempt + 1 >= MAX_BREW_ATTEMPTS || !isRetryableModelError(error)) throw error;
          console.error(`Retrying brew after ${error.message}`);
        }
      }
      throw lastError;
    }
    const results = Array(count);
    let cursor = 0;
    async function worker() {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= count) return;
        results[index] = await requestWithRetry(index);
      }
    }
    await Promise.all(Array.from({ length: Math.min(count, MAX_PARALLEL_BREWS) }, () => worker()));
    const items = results.flat().map((item, index) => ({ ...item, n: String(index + 1).padStart(2, '0') }));
    const edition = historicalDate ? { run_date: historicalDate, mode: 'historical', provider, model: modelForProvider(provider), requested_count: 10, title: 'Vibe Coding 每日手沖', generated_at: new Date().toISOString(), items } : null;
    return res.status(200).json({ items, model: modelForProvider(provider), provider, ...(edition ? { edition, persisted: false } : {}) });
  } catch (error) {
    console.error(`Vercel brew failed: ${error.message}`);
    const status = error.status || (isTimeoutError(error) ? 504 : error.message === 'source_after_as_of_date' ? 502 : 502);
    const message = error.message === 'source_after_as_of_date' ? '模型回傳了公示日期之後的來源，這一批沒有保存。' : publicErrorMessage(error);
    return res.status(status).json({ error: message });
  }
}
