import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUTPUT_DIR = path.join(ROOT, 'outputs', 'vibe-coding-daily-brew', 'daily');
const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v4-flash-0731';
const COUNT = 10;
const FORMULA_VERSION = 'v1';

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return {};
  return Object.fromEntries(readFileSync(filePath, 'utf8').split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (!match) return [];
    return [[match[1], match[2].replace(/^['"]|['"]$/g, '')]];
  }));
}

const localEnv = loadDotEnv(path.join(ROOT, '.env.local'));
const config = { ...localEnv, ...process.env };

function localDate() {
  const date = new Date();
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 10);
}

function parseArgs(argv) {
  const options = { date: localDate(), outputDir: DEFAULT_OUTPUT_DIR, force: false, dryRun: false, quiet: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--date') options.date = argv[++index];
    else if (arg === '--output-dir') options.outputDir = path.resolve(argv[++index]);
    else if (arg === '--force') options.force = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--quiet') options.quiet = true;
    else throw new Error(`unknown_argument:${arg}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date) || Number.isNaN(Date.parse(`${options.date}T00:00:00Z`))) {
    throw new Error(`invalid_date:${options.date}`);
  }
  return options;
}

function log(options, message) {
  if (!options.quiet) console.log(`[daily-brew] ${message}`);
}

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error('score_missing');
  return Math.min(max, Math.max(min, Math.round(number)));
}

function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`field_missing:${field}`);
  return value.trim();
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(part => typeof part === 'string' ? part : part?.text || '').join('');
  if (content && typeof content === 'object') {
    if ('text' in content) return extractText(content.text);
    if ('content' in content) return extractText(content.content);
    if ('parts' in content) return extractText(content.parts);
  }
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

function ageDays(runDate, publishedAt) {
  return Math.max(0, Math.floor((Date.parse(`${runDate}T00:00:00Z`) - Date.parse(publishedAt)) / 86_400_000));
}

function rankingBase(runDate, item) {
  const age = ageDays(runDate, item.source.published_at);
  const recency = 5 * Math.exp(-age / 30);
  const base = 0.52 * recency + 0.25 * item.scores.importance + 0.13 * item.scores.timeless + 0.10 * item.scores.popularity;
  return { age_days: age, recency: Number(recency.toFixed(2)), base: Number(base.toFixed(2)) };
}

function normalizeItems(payload, runDate) {
  if (!payload || !Array.isArray(payload.items) || payload.items.length !== COUNT) throw new Error('model_must_return_exactly_10_items');
  const seenUrls = new Set();
  const seenClaims = new Set();
  const items = payload.items.map((raw, index) => {
    const source = raw?.source || {};
    const url = requiredText(source.url, `items[${index}].source.url`);
    if (!/^https?:\/\//i.test(url)) throw new Error(`source_url_invalid:${index + 1}`);
    const canonicalUrl = url.replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
    if (seenUrls.has(canonicalUrl)) throw new Error(`duplicate_source_url:${url}`);
    seenUrls.add(canonicalUrl);
    const claim = requiredText(raw.title, `items[${index}].title`).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
    if (seenClaims.has(claim)) throw new Error(`duplicate_lesson_claim:${raw.title}`);
    seenClaims.add(claim);
    const publishedAt = requiredText(source.published_at, `items[${index}].source.published_at`);
    if (Number.isNaN(Date.parse(publishedAt))) throw new Error(`source_date_invalid:${index + 1}`);
    const publishedDate = new Date(publishedAt).toISOString().slice(0, 10);
    if (publishedDate > runDate) throw new Error(`source_date_after_run_date:${index + 1}`);
    const item = {
      category: requiredText(raw.category, `items[${index}].category`),
      secondary_categories: Array.isArray(raw.secondary_categories) ? raw.secondary_categories.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()) : [],
      takeaway: requiredText(raw.takeaway, `items[${index}].takeaway`),
      title: requiredText(raw.title, `items[${index}].title`),
      problem: requiredText(raw.problem, `items[${index}].problem`),
      principle: requiredText(raw.principle, `items[${index}].principle`),
      try_it: requiredText(raw.try_it, `items[${index}].try_it`),
      tradeoffs: requiredText(raw.tradeoffs, `items[${index}].tradeoffs`),
      practice_prompt: requiredText(raw.practice_prompt, `items[${index}].practice_prompt`),
      source_says: requiredText(raw.source_says || 'unknown', `items[${index}].source_says`),
      editorial_synthesis: requiredText(raw.editorial_synthesis || 'unknown', `items[${index}].editorial_synthesis`),
      classic_reserve: Boolean(raw.classic_reserve),
      source: {
        url,
        platform: requiredText(source.platform, `items[${index}].source.platform`),
        author: requiredText(source.author, `items[${index}].source.author`),
        published_at: new Date(publishedAt).toISOString(),
        evidence_excerpt: requiredText(source.evidence_excerpt || 'unknown', `items[${index}].source.evidence_excerpt`),
        engagement: requiredText(source.engagement || 'unknown', `items[${index}].source.engagement`),
        popularity_basis: requiredText(source.popularity_basis || 'unavailable', `items[${index}].source.popularity_basis`)
      },
      scores: {
        timeless: clamp(raw.scores?.timeless, 1, 5),
        importance: clamp(raw.scores?.importance, 1, 5),
        popularity: clamp(raw.scores?.popularity, 1, 5),
        timeless_reason: requiredText(raw.scores?.timeless_reason || 'unknown', `items[${index}].scores.timeless_reason`),
        importance_reason: requiredText(raw.scores?.importance_reason || 'unknown', `items[${index}].scores.importance_reason`),
        popularity_reason: requiredText(raw.scores?.popularity_reason || 'unknown', `items[${index}].scores.popularity_reason`),
        confidence: Math.min(1, Math.max(0, Number(raw.scores?.confidence ?? 0)))
      }
    };
    return { ...item, ranking: rankingBase(runDate, item) };
  });
  const categories = new Map();
  for (const item of items) categories.set(item.category, (categories.get(item.category) || 0) + 1);
  if ([...categories.values()].some(count => count > 2)) throw new Error('category_limit_exceeded');
  if (new Set(items.map(item => item.source.platform)).size < 3) throw new Error('need_at_least_3_sources');
  items.sort((a, b) => b.ranking.base - a.ranking.base || b.scores.importance - a.scores.importance || b.scores.timeless - a.scores.timeless || b.source.published_at.localeCompare(a.source.published_at) || a.source.url.localeCompare(b.source.url));
  return items.map((item, index) => ({
    ...item,
    n: String(index + 1).padStart(2, '0'),
    tag: item.classic_reserve ? '經典保留' : item.ranking.age_days <= 30 ? '新鮮實作' : '近期耐用',
    time: '6 分鐘',
    source_display: `${item.source.platform} · ${item.source.author}`,
    date: item.source.published_at.slice(0, 10),
    heat: item.scores.popularity,
    timeless: item.scores.timeless,
    importance: item.scores.importance,
    evidence: item.source_says !== 'unknown' ? item.source_says : item.editorial_synthesis,
    prompt: item.practice_prompt,
    tryIt: item.try_it,
    tradeoffs: item.tradeoffs,
    sourceType: item.source.platform,
    source: `${item.source.platform} · ${item.source.author}`,
    url: item.source.url,
    classic: item.classic_reserve
  }));
}

function buildPrompt(runDate) {
  return `今天是 ${runDate}，資料截點也是 ${runDate}。請為「Vibe Coding Daily Brew」挑選恰好 10 個可長久重用的 Vibe Coding 發現。所有 source.published_at 必須小於或等於 ${runDate}，不得使用之後才發布、更新或發生的內容。這個專案是一個繁體中文、可列印的每日學習頁；讀者需要的是可驗證的工程實作，而不是產品新聞、模型發布、募資、流行金句或功能清單。\n\n請使用可用的 web search，搜尋近期社群討論、開發者論壇、GitHub issue/discussion、技術文章與回覆，優先採用有具體 workflow、程式碼、測試、失敗分析、反例或可重複決策規則的來源。每篇只能教一個可轉移的 idea。請保留來源事實與編輯推論的界線，不確定的作者、日期、URL、互動或引文不得捏造。\n\n依 vibe-coding-curator skill 的 ranking-and-evidence 規範評分，使用 formula_version v1：recency = 5 * exp(-age_days / 30)；base = 0.52 * recency + 0.25 * importance + 0.13 * timeless + 0.10 * popularity。三個分數都是 1–5 整數；若 popularity 無可觀察數據，最多給 2。至少 3 個不同平台/來源，單一 primary category 最多 2 篇；最多保留 2 篇符合條件的 90 天以上經典。\n\n只回傳 JSON object，不要 Markdown 或前言，格式：\n{"items":[{"title":"...","category":"思考|提示設計|Agent 管理|上下文工程|程式碼理解|驗證|工作流程|工藝與心態|安全|協作|學習系統","secondary_categories":["..."],"takeaway":"...","problem":"...","principle":"...","try_it":"...","tradeoffs":"...","practice_prompt":"...","source_says":"一句由來源支持的短 paraphrase","editorial_synthesis":"清楚標示這是編輯綜合或 inference","classic_reserve":false,"source":{"url":"https://canonical-source","platform":"...","author":"...","published_at":"YYYY-MM-DD or ISO-8601","evidence_excerpt":"短 paraphrase 或不超過 25 字的合規短引文","engagement":"可觀察互動證據；未知就填 unknown","popularity_basis":"如何依平台與文章年齡解讀互動；未知就填 unavailable"},"scores":{"timeless":1,"importance":1,"popularity":1,"timeless_reason":"...","importance_reason":"...","popularity_reason":"...","confidence":0.0}}]}\n\n不要回傳第 11 篇，也不要用 placeholder 網址；若找不到足夠有證據的候選，仍回傳可驗證的 10 篇，不要創造來源。`;
}

async function requestItems(runDate) {
  const key = config.OPENROUTER_API_KEY?.trim();
  if (!key) throw new Error('api_key_missing');
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Vibe Coding Daily Brew' },
      body: JSON.stringify({
        model: config.OPENROUTER_MODEL || MODEL,
        messages: [
          { role: 'system', content: '你是遵守 vibe-coding-curator skill 的嚴謹繁體中文編輯。只保留有來源、有證據、可轉移、可實作的做法。10 篇必須有 10 個不同 canonical URL，且 primary category 不得超過 2 篇。只輸出合法 JSON object。' },
          { role: 'user', content: `${buildPrompt(runDate)}\n\n這是第 ${attempt + 1} 次嘗試。請先在內部完成檢查，再一次性輸出完整 JSON；不要輸出分析、Markdown、引用標記或 JSON 以外的文字。` }
        ],
        temperature: attempt === 0 ? 0.2 : 0.05,
        max_tokens: 20_000,
        plugins: [{ id: 'web' }],
        response_format: { type: 'json_object' }
      }),
      signal: AbortSignal.timeout(120_000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`upstream_failed:${response.status}`);
    try {
      const message = payload.choices?.[0]?.message || {};
      const rawContent = extractText(message.content) || extractText(message.reasoning);
      return normalizeItems(parseJsonAnswer(rawContent), runDate);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('model_json_missing');
}

async function writeJson(filePath, value) {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, filePath);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const datedPath = path.join(options.outputDir, `${options.date}.json`);
  const latestPath = path.join(options.outputDir, 'latest.json');
  await mkdir(options.outputDir, { recursive: true });
  if (!options.force && !options.dryRun) {
    try {
      await access(datedPath);
      log(options, `already_generated:${datedPath}`);
      return;
    } catch {}
  }
  if (options.dryRun) {
    log(options, `dry_run date=${options.date} count=${COUNT} output=${datedPath}`);
    log(options, 'dry_run triggers=AtLogOn,Daily@06:00 local time; same-day output is idempotent');
    return;
  }
  log(options, `collecting:${options.date}`);
  const items = await requestItems(options.date);
  const edition = {
    run_date: options.date,
    mode: 'daily',
    requested_count: COUNT,
    formula_version: FORMULA_VERSION,
    title: 'Vibe Coding 每日手沖',
    objective: '從當前社群討論中挑出十個可驗證、可轉移、值得留下的 Vibe Coding 做法，讓今天的學習可以在下一次工作循環裡被使用。',
    generated_at: new Date().toISOString(),
    items
  };
  await writeJson(datedPath, edition);
  await writeJson(latestPath, edition);
  log(options, `generated:${datedPath}`);
}

main().catch(error => {
  console.error(`[daily-brew] failed:${error.message}`);
  process.exitCode = 1;
});
