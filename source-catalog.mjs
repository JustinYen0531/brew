import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const SOURCE_CATALOG_FILE = path.join(ROOT, 'data', 'vibe-coding-source-catalog.json');
export const SOURCE_RANKING_VERSION = 'source-v1';

export async function readSourceCatalog() {
  return JSON.parse(await readFile(SOURCE_CATALOG_FILE, 'utf8'));
}

function normalized(value) {
  return String(value || '').toLocaleLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
}

function sourceText(source) {
  return [source.name, source.platform, source.kind, source.description, ...(source.aliases || []), ...(source.topics || [])].join(' ');
}

export function sourceMatchesQuery(source, query) {
  const needle = normalized(query);
  if (!needle) return true;
  const haystack = normalized(sourceText(source));
  return haystack.includes(needle) || normalized(source.name).includes(needle) || (source.aliases || []).some(alias => normalized(alias).includes(needle));
}

function scoreSource(source, query) {
  const needle = normalized(query);
  const haystack = normalized(sourceText(source));
  const quality = Number(source.qualityScore) || 1;
  const influence = Number(source.influenceScore) || 1;
  const signal = Number(source.signalScore) || 1;
  const accessibility = Number(source.accessibilityScore) || 1;
  let score = 0.42 * quality + 0.25 * influence + 0.23 * signal + 0.10 * accessibility;
  if (needle) {
    if (normalized(source.name) === needle) score += 3;
    else if (normalized(source.name).includes(needle)) score += 2;
    else if ((source.aliases || []).some(alias => normalized(alias).includes(needle))) score += 1.75;
    else if (haystack.includes(needle)) score += 0.75;
    else score -= 1.5;
  } else if (source.defaultSelected) {
    score += 0.25;
  }
  return Number(score.toFixed(3));
}

export function rankSources(sources, query = '', limit = 10) {
  return [...sources]
    .map(source => ({ ...source, recommendationScore: scoreSource(source, query) }))
    .sort((a, b) => b.recommendationScore - a.recommendationScore || Number(b.qualityScore) - Number(a.qualityScore) || a.name.localeCompare(b.name))
    .slice(0, Math.max(1, Math.min(10, Number(limit) || 10)));
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(part => extractText(part)).join('');
  if (content && typeof content === 'object') {
    if ('text' in content) return extractText(content.text);
    if ('content' in content) return extractText(content.content);
    if ('parts' in content) return extractText(content.parts);
  }
  return '';
}

function extractOpenAIText(payload) {
  if (typeof payload?.output_text === 'string') return payload.output_text;
  const parts = (payload?.output || []).flatMap(item => Array.isArray(item?.content) ? item.content : []);
  return parts.filter(part => part?.type === 'output_text').map(part => part.text || '').join('');
}

function parseJson(text) {
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('source_json_missing');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function canonicalUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!/^https?:$/.test(url.protocol)) return '';
    url.hash = '';
    return url.href.replace(/\/$/, '');
  } catch { return ''; }
}

export function normalizeDiscoveredSources(payload, query, verifiedAt = new Date().toISOString().slice(0, 10)) {
  if (!payload || !Array.isArray(payload.sources)) return [];
  const seen = new Set();
  return payload.sources.map((source, index) => {
    const url = canonicalUrl(source.url);
    if (!url || seen.has(url)) return null;
    seen.add(url);
    const name = String(source.name || '').trim();
    const platform = String(source.platform || '').trim();
    if (!name || !platform) return null;
    return {
      id: `live-${Buffer.from(url).toString('base64url').slice(0, 18)}-${index}`,
      name,
      platform,
      kind: String(source.kind || '社群／內容來源').trim(),
      url,
      aliases: Array.isArray(source.aliases) ? source.aliases.filter(value => typeof value === 'string').slice(0, 8) : [],
      topics: Array.isArray(source.topics) ? source.topics.filter(value => typeof value === 'string').slice(0, 8) : [],
      description: String(source.description || '由即時搜尋找到的 Vibe Coding 來源。').trim(),
      evidence: String(source.evidence || 'unknown').trim(),
      evidenceUrl: canonicalUrl(source.evidenceUrl) || url,
      qualityScore: Math.min(5, Math.max(1, Number(source.qualityScore) || 3)),
      influenceScore: Math.min(5, Math.max(1, Number(source.influenceScore) || 2)),
      signalScore: Math.min(5, Math.max(1, Number(source.signalScore) || 2)),
      accessibilityScore: Math.min(5, Math.max(1, Number(source.accessibilityScore) || 3)),
      confidence: Math.min(1, Math.max(0, Number(source.confidence) || 0.5)),
      verifiedAt,
      discoveredFor: query,
      defaultSelected: false,
      live: true
    };
  }).filter(Boolean);
}

export async function discoverSources(query, { apiKey, model, limit = 5, provider = 'openrouter' } = {}) {
  if (!apiKey || String(query || '').trim().length < 2) return [];
  const isOpenAI = provider === 'openai';
  const response = await fetch(isOpenAI ? 'https://api.openai.com/v1/responses' : 'https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(isOpenAI ? {} : { 'X-Title': 'Vibe Coding Source Discovery' }) },
    body: isOpenAI ? {
      model,
      instructions: '你是嚴謹的 Vibe Coding 來源研究員。只推薦真實、可開啟、可驗證的來源提供者；不要把單篇文章冒充成媒體，也不要捏造影響力。只輸出合法 JSON。',
      input: `搜尋「${String(query).slice(0, 160)}」相關的 Vibe Coding / AI coding agent 資訊提供者，最多 ${limit} 個。優先社群、技術文章、教學、案例、開發者論壇、影音頻道或可維護的資源庫；排除純產品廣告、搜尋結果頁與無法驗證的名稱。\n\n請只回傳：{"sources":[{"name":"...","platform":"...","kind":"...","url":"https://canonical-provider-url","aliases":["..."],"topics":["..."],"description":"...","evidence":"可觀察的內容品質或社群訊號","evidenceUrl":"https://evidence-url","qualityScore":1,"influenceScore":1,"signalScore":1,"accessibilityScore":1,"confidence":0.0}]}`,
      tools: [{ type: 'web_search_preview' }],
      max_output_tokens: 3500,
      text: { format: { type: 'json_object' } }
    } : {
      model,
      messages: [
        { role: 'system', content: '你是嚴謹的 Vibe Coding 來源研究員。只推薦真實、可開啟、可驗證的來源提供者；不要把單篇文章冒充成媒體，也不要捏造影響力。只輸出合法 JSON。' },
        { role: 'user', content: `搜尋「${String(query).slice(0, 160)}」相關的 Vibe Coding / AI coding agent 資訊提供者，最多 ${limit} 個。優先社群、技術文章、教學、案例、開發者論壇、影音頻道或可維護的資源庫；排除純產品廣告、搜尋結果頁與無法驗證的名稱。\n\n請只回傳：{"sources":[{"name":"...","platform":"...","kind":"...","url":"https://canonical-provider-url","aliases":["..."],"topics":["..."],"description":"...","evidence":"可觀察的內容品質或社群訊號","evidenceUrl":"https://evidence-url","qualityScore":1,"influenceScore":1,"signalScore":1,"accessibilityScore":1,"confidence":0.0}]}` }
      ],
      temperature: 0.15,
      max_tokens: 3500,
      plugins: [{ id: 'web' }],
      response_format: { type: 'json_object' }
    },
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) return [];
  const data = await response.json().catch(() => ({}));
  const message = data.choices?.[0]?.message || {};
  const text = isOpenAI ? extractOpenAIText(data) : extractText(message.content) || extractText(message.reasoning);
  try { return normalizeDiscoveredSources(parseJson(text), query); } catch { return []; }
}
