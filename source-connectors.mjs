const DEFAULT_SOURCE_IDS = ['github-community', 'hacker-news', 'reddit-vibecoding', 'dev-community'];
const DEFAULT_LIMIT_PER_SOURCE = 8;
const DEFAULT_TIMEOUT_MS = 6_000;
const UNSUPPORTED_SOURCES = new Set(['facebook', 'line-vibecoding-weekly', 'roboco-manual']);

function text(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function decodeEntities(value) {
  return text(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
}

function stripHtml(value) {
  return decodeEntities(String(value || '').replace(/<[^>]+>/g, ' ')).slice(0, 700);
}

function canonicalUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return '';
    url.hash = '';
    return url.href.replace(/\/$/, '') || url.origin;
  } catch { return ''; }
}

function dateOnly(value) {
  const parsed = new Date(value || '');
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

function firstMatch(block, patterns = []) {
  for (const pattern of patterns) {
    const match = block.match(pattern);
    if (match?.[1]) return decodeEntities(match[1]);
  }
  return '';
}

function parseFeed(xml, baseUrl, sourceType) {
  const itemBlocks = [...String(xml || '').matchAll(/<(?:item|entry)\b[^>]*>[\s\S]*?<\/(?:item|entry)>/gi)].map(match => match[0]);
  return itemBlocks.flatMap(block => {
    const title = stripHtml(firstMatch(block, [/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i, /<title[^>]*>([\s\S]*?)<\/title>/i]));
    const link = firstMatch(block, [/<link[^>]+href=["']([^"']+)["']/i, /<link[^>]*>([\s\S]*?)<\/link>/i]);
    const description = stripHtml(firstMatch(block, [/<description[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i, /<description[^>]*>([\s\S]*?)<\/description>/i, /<summary[^>]*>([\s\S]*?)<\/summary>/i, /<content[^>]*>([\s\S]*?)<\/content>/i]));
    const published = firstMatch(block, [/<published[^>]*>([\s\S]*?)<\/published>/i, /<updated[^>]*>([\s\S]*?)<\/updated>/i, /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i, /<dc:date[^>]*>([\s\S]*?)<\/dc:date>/i, /<date[^>]*>([\s\S]*?)<\/date>/i]);
    const url = canonicalUrl(link);
    const publishedAt = dateOnly(published);
    if (!title || !url || !publishedAt) return [];
    return [{
      title,
      url,
      date: publishedAt,
      sourceType,
      source: sourceType,
      category: '來源探索',
      difficulty: '普通',
      evidence: description || title,
      takeaway: description || title,
      problem: '',
      principle: '',
      tryIt: '',
      tradeoffs: '',
      timeless: 3,
      importance: 3,
      heat: 2
    }];
  });
}

function queryText(preferences = {}) {
  const topics = Array.isArray(preferences.topics) ? preferences.topics.slice(0, 6) : [];
  const specific = Object.values(preferences.specificSources || {}).filter(Boolean).slice(0, 4);
  const prompt = text(preferences.sourcePrompt || preferences.source_prompt || preferences.prompt).slice(0, 180);
  return [...topics, ...specific, prompt].filter(Boolean).join(' ').slice(0, 300) || 'vibe coding coding agent workflow';
}

function sourceLanguageSuffix(preferences = {}) {
  const language = preferences.sourceLanguage || preferences.source_language;
  return language === 'en' ? ' practical workflow' : ' 實作 方法';
}

function requestHeaders(sourceType) {
  return {
    Accept: 'application/json, application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8',
    'User-Agent': `VibeCodingDailyBrew/1.0 (+${sourceType})`
  };
}

async function fetchText(url, { fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, sourceType } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch_unavailable');
  const response = await fetchImpl(url, { headers: requestHeaders(sourceType), signal: AbortSignal.timeout(timeoutMs) });
  const body = await response.text();
  if (!response.ok) throw new Error(`http_${response.status}`);
  return { body, contentType: response.headers?.get?.('content-type') || '', lastModified: response.headers?.get?.('last-modified') || '' };
}

function normalizeJsonCandidate({ title, url, date, description, sourceType, category = '來源探索' }) {
  const canonical = canonicalUrl(url);
  const publishedAt = dateOnly(date);
  const cleanTitle = text(title);
  const evidence = stripHtml(description) || cleanTitle;
  if (!canonical || !publishedAt || !cleanTitle || !evidence) return null;
  return {
    title: cleanTitle.slice(0, 240),
    url: canonical,
    date: publishedAt,
    sourceType,
    source: sourceType,
    category,
    difficulty: '普通',
    evidence: evidence.slice(0, 700),
    takeaway: evidence.slice(0, 700),
    problem: '',
    principle: '',
    tryIt: '',
    tradeoffs: '',
    timeless: 3,
    importance: 3,
    heat: 2
  };
}

async function githubConnector(preferences, options) {
  const query = encodeURIComponent(`${queryText(preferences)}${sourceLanguageSuffix(preferences)}`);
  const url = `https://api.github.com/search/issues?q=${query}+is:public&sort=updated&order=desc&per_page=${options.limit}`;
  const { body } = await fetchText(url, { ...options, sourceType: 'GitHub' });
  const payload = JSON.parse(body);
  return (Array.isArray(payload.items) ? payload.items : []).flatMap(item => {
    const candidate = normalizeJsonCandidate({ title: item.title, url: item.html_url, date: item.updated_at || item.created_at, description: item.body || item.title, sourceType: 'GitHub', category: item.pull_request ? '程式碼理解' : '開發者討論' });
    return candidate ? [candidate] : [];
  });
}

async function hackerNewsConnector(preferences, options) {
  const query = encodeURIComponent(queryText(preferences));
  const url = `https://hn.algolia.com/api/v1/search_by_date?query=${query}&tags=story&hitsPerPage=${options.limit}`;
  const { body } = await fetchText(url, { ...options, sourceType: 'Hacker News' });
  const payload = JSON.parse(body);
  return (Array.isArray(payload.hits) ? payload.hits : []).flatMap(item => {
    const candidate = normalizeJsonCandidate({ title: item.title || item.story_title, url: item.url || `https://news.ycombinator.com/item?id=${item.objectID}`, date: item.created_at, description: item.story_text || item.comment_text || item.title, sourceType: 'Hacker News', category: '開發者討論' });
    return candidate ? [candidate] : [];
  });
}

async function redditConnector(preferences, options) {
  const query = encodeURIComponent(queryText(preferences));
  const url = `https://www.reddit.com/r/vibecoding/search.rss?q=${query}&restrict_sr=1&sort=new&limit=${options.limit}`;
  const { body } = await fetchText(url, { ...options, sourceType: 'Reddit' });
  return parseFeed(body, url, 'Reddit');
}

async function devConnector(preferences, options) {
  const tag = encodeURIComponent((preferences.topics?.[0] || 'ai').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-|-$/g, '') || 'ai');
  const url = `https://dev.to/api/articles?tag=${tag}&per_page=${options.limit}`;
  const { body } = await fetchText(url, { ...options, sourceType: 'DEV.to' });
  const payload = JSON.parse(body);
  return (Array.isArray(payload) ? payload : []).flatMap(item => {
    const candidate = normalizeJsonCandidate({ title: item.title, url: item.url, date: item.published_at || item.created_at, description: item.description || item.title, sourceType: 'DEV.to', category: '技術文章' });
    return candidate ? [candidate] : [];
  });
}

async function rssConnector(url, sourceType, options) {
  const response = await fetchText(url, { ...options, sourceType });
  return parseFeed(response.body, url, sourceType);
}

async function directUrlConnector(url, options) {
  const sourceType = `指定來源 · ${new URL(url).hostname}`;
  const response = await fetchText(url, { ...options, sourceType });
  const isFeed = /xml|rss|atom/i.test(response.contentType) || /^\s*<(?:rss|feed|\?xml)/i.test(response.body);
  if (isFeed) return parseFeed(response.body, url, sourceType);
  const title = stripHtml(firstMatch(response.body, [/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i, /<title[^>]*>([\s\S]*?)<\/title>/i]));
  const description = stripHtml(firstMatch(response.body, [/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i]));
  const published = firstMatch(response.body, [/<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i, /<time[^>]+datetime=["']([^"']+)["']/i]) || response.lastModified;
  const candidate = normalizeJsonCandidate({ title, url, date: published, description, sourceType, category: '指定來源' });
  return candidate ? [candidate] : [];
}

const CONNECTORS = {
  'github-community': (preferences, options) => githubConnector(preferences, options),
  'awesome-vibecoding': (preferences, options) => githubConnector(preferences, options),
  'hacker-news': (preferences, options) => hackerNewsConnector(preferences, options),
  'reddit-vibecoding': (preferences, options) => redditConnector(preferences, options),
  'dev-community': (preferences, options) => devConnector(preferences, options),
  'openai-community': (_preferences, options) => rssConnector('https://community.openai.com/latest.rss', 'OpenAI Community', options),
  'indie-hackers': (_preferences, options) => rssConnector('https://www.indiehackers.com/feed.xml', 'Indie Hackers', options),
  'vibecoding-tw': (_preferences, options) => rssConnector('https://vibecoding.tw/feed.xml', 'Vibe Coding Taiwan', options)
};

function selectedSourceIds(preferences = {}) {
  const ids = Array.isArray(preferences.selectedSourceIds) ? preferences.selectedSourceIds.filter(Boolean) : [];
  return ids.length ? [...new Set(ids)].slice(0, 20) : DEFAULT_SOURCE_IDS;
}

function customSourceUrls(preferences = {}) {
  return [...(Array.isArray(preferences.selectedSources) ? preferences.selectedSources : []), ...(Array.isArray(preferences.customSources) ? preferences.customSources : [])]
    .map(source => canonicalUrl(source?.url))
    .filter(Boolean);
}

export async function collectSourceCandidates(preferences = {}, asOfDate = '', { fetchImpl = globalThis.fetch, limitPerSource = DEFAULT_LIMIT_PER_SOURCE, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const directUrls = Array.isArray(preferences.directUrls) && preferences.directUrls.length ? [...new Set(preferences.directUrls.map(canonicalUrl).filter(Boolean))].slice(0, 10) : [];
  const requested = directUrls.length ? directUrls.map(url => `direct:${url}`) : selectedSourceIds(preferences);
  const connectors = [];
  const candidates = [];
  await Promise.all(requested.map(async sourceId => {
    const isDirect = sourceId.startsWith('direct:');
    const sourceUrl = isDirect ? sourceId.slice(7) : '';
    if (!isDirect && UNSUPPORTED_SOURCES.has(sourceId) || !isDirect && sourceId === 'facebook') {
      connectors.push({ source_id: sourceId, status: 'unsupported', candidate_count: 0, note: '需要官方 API、合法授權或手動匯入；未進行爬取。' });
      return;
    }
    const connector = isDirect ? (_preferences, options) => directUrlConnector(sourceUrl, options) : CONNECTORS[sourceId];
    if (!connector) {
      connectors.push({ source_id: sourceId, status: 'unavailable', candidate_count: 0, note: '目前沒有已驗證的公開連接器。' });
      return;
    }
    try {
      const result = await connector(preferences, { fetchImpl, limit: Math.max(1, Math.min(12, limitPerSource)), timeoutMs });
      const valid = result.filter(item => item?.url && item?.date && (!asOfDate || item.date <= asOfDate));
      candidates.push(...valid);
      connectors.push({ source_id: sourceId, status: valid.length ? 'ok' : 'empty', candidate_count: valid.length });
    } catch (error) {
      connectors.push({ source_id: sourceId, status: 'error', candidate_count: 0, error: String(error?.message || 'connector_failed').slice(0, 120) });
    }
  }));
  const seen = new Set();
  const unique = candidates.filter(candidate => {
    const key = canonicalUrl(candidate.url).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 80);
  const customUrls = customSourceUrls(preferences);
  return {
    candidates: unique,
    snapshot: {
      version: 'source-collection-v1',
      as_of_date: asOfDate,
      requested_source_ids: requested,
      hard_direct_url_scope: directUrls.length > 0,
      custom_source_count: customUrls.length,
      candidate_count: unique.length,
      connectors: connectors.sort((left, right) => left.source_id.localeCompare(right.source_id)),
      fallback_to_model_search: unique.length === 0,
      policy: '只使用公開介面、RSS、使用者指定網址或合法授權；無法讀取時明確標記。'
    }
  };
}

export const sourceConnectorCatalog = Object.freeze(Object.keys(CONNECTORS));
