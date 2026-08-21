import {
  ApiError,
  apiResponseHeaders,
  getSupabaseConfig,
  getVerifiedSupabaseUser,
  readBearerToken,
  requestOriginInfo,
  supabaseRequest
} from './auth.mjs';

const ARRAY_RULES = {
  topics: { limit: 12, maxLength: 80 },
  excluded_topics: { limit: 12, maxLength: 80 },
  content_styles: { limit: 8, maxLength: 80 },
  source_lanes: { limit: 8, maxLength: 120 },
  difficulty_levels: { limit: 3, maxLength: 4 }
};
const DIFFICULTY_LEVELS = ['初學者', '普通', '困難'];
const ALLOWED_READING_MINUTES = [5, 10, 20];
const ALLOWED_ITEM_COUNTS = [5, 10, 15];

function sourceRecord(raw = {}) {
  if (raw?.preferences && typeof raw.preferences === 'object' && !Array.isArray(raw.preferences)) return raw.preferences;
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function firstDefined(raw, snakeName, camelName) {
  return raw[snakeName] !== undefined ? raw[snakeName] : raw[camelName];
}

function normalizeStringArray(value, rule) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const normalized = entry.trim().slice(0, rule.maxLength);
    if (!normalized || result.includes(normalized)) continue;
    result.push(normalized);
    if (result.length >= rule.limit) break;
  }
  return result;
}

function normalizeNumber(value, allowed, fallback) {
  const number = Number(value);
  return allowed.includes(number) ? number : fallback;
}

function normalizeBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

export function sanitizePreferenceRecord(raw = {}) {
  const input = sourceRecord(raw);
  const topics = normalizeStringArray(firstDefined(input, 'topics', 'topics'), ARRAY_RULES.topics);
  const excludedTopics = normalizeStringArray(firstDefined(input, 'excluded_topics', 'excludedTopics'), ARRAY_RULES.excluded_topics);
  const contentStyles = normalizeStringArray(firstDefined(input, 'content_styles', 'contentStyles'), ARRAY_RULES.content_styles);
  const sourceLanes = normalizeStringArray(firstDefined(input, 'source_lanes', 'sourceLanes'), ARRAY_RULES.source_lanes);
  const difficultyLevels = normalizeStringArray(firstDefined(input, 'difficulty_levels', 'difficultyLevels'), ARRAY_RULES.difficulty_levels)
    .filter(value => DIFFICULTY_LEVELS.includes(value));

  return {
    topics,
    excluded_topics: excludedTopics,
    content_styles: contentStyles,
    source_lanes: sourceLanes,
    difficulty_levels: difficultyLevels.length ? difficultyLevels : ['普通'],
    reading_minutes: normalizeNumber(firstDefined(input, 'reading_minutes', 'readingMinutes'), ALLOWED_READING_MINUTES, 10),
    item_count: normalizeNumber(firstDefined(input, 'item_count', 'itemCount'), ALLOWED_ITEM_COUNTS, 10),
    novelty_level: Math.min(5, Math.max(1, Number.isFinite(Number(firstDefined(input, 'novelty_level', 'noveltyLevel'))) ? Math.round(Number(firstDefined(input, 'novelty_level', 'noveltyLevel'))) : 3)),
    review_enabled: normalizeBoolean(firstDefined(input, 'review_enabled', 'reviewEnabled'), true),
    onboarding_completed: normalizeBoolean(firstDefined(input, 'onboarding_completed', 'onboardingCompleted'), false)
  };
}

function preferencesUpstreamError(response) {
  if (response.status === 401 || response.status === 403) return new ApiError('auth_invalid', 401, '登入已失效，請重新取得登入連結。');
  return new ApiError('preferences_upstream', 502, '晨報配方暫時無法讀取或保存，請稍後再試。');
}

async function readPreferences(user, token, config) {
  const endpoint = new URL('/rest/v1/brew_preferences', `${config.url}/`);
  endpoint.searchParams.set('user_id', `eq.${user.id}`);
  endpoint.searchParams.set('select', '*');
  const { response, data } = await supabaseRequest(config, `${endpoint.pathname}${endpoint.search}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw preferencesUpstreamError(response);
  if (!Array.isArray(data)) throw new ApiError('preferences_upstream', 502, '晨報配方暫時無法讀取，請稍後再試。');
  return data[0] || null;
}

async function savePreferences(user, token, config, raw) {
  const sanitized = sanitizePreferenceRecord(raw);
  const record = {
    user_id: user.id,
    ...sanitized,
    updated_at: new Date().toISOString()
  };
  const endpoint = new URL('/rest/v1/brew_preferences', `${config.url}/`);
  endpoint.searchParams.set('on_conflict', 'user_id');
  const { response, data } = await supabaseRequest(config, `${endpoint.pathname}${endpoint.search}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify(record)
  });
  if (!response.ok) throw preferencesUpstreamError(response);
  const saved = Array.isArray(data) ? data[0] : data;
  return saved && typeof saved === 'object' ? saved : record;
}

function normalizeBody(body) {
  if (body === undefined || body === null || body === '') return {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch { throw new ApiError('invalid_json', 400, '請傳送有效的 JSON。'); }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError('invalid_json', 400, '請傳送有效的 JSON。');
  return body;
}

function errorResponse(error, originInfo = {}) {
  const known = error instanceof ApiError;
  return {
    status: known ? error.status : 500,
    body: { error: known ? error.safeMessage : '晨報配方服務暫時無法使用，請稍後再試。' },
    headers: apiResponseHeaders(originInfo)
  };
}

export async function preferencesApi(input = {}) {
  let originInfo = {};
  try { originInfo = requestOriginInfo(input); }
  catch (error) { return errorResponse(error); }
  const headers = apiResponseHeaders(originInfo);
  try {
    if (input.method === 'OPTIONS') return { status: 204, body: undefined, headers };
    if (!['GET', 'PUT'].includes(input.method)) throw new ApiError('method_not_allowed', 405, '這個晨報配方入口不接受目前的請求方式。');
    const config = getSupabaseConfig(input.env || process.env);
    const token = readBearerToken(input.headers);
    const user = await getVerifiedSupabaseUser(token, config);
    if (input.method === 'GET') return { status: 200, body: { preferences: await readPreferences(user, token, config) }, headers };
    const saved = await savePreferences(user, token, config, normalizeBody(input.body));
    return { status: 200, body: { preferences: saved }, headers };
  } catch (error) {
    return errorResponse(error, originInfo);
  }
}

export default async function handler(req, res) {
  const result = await preferencesApi({ method: req.method, headers: req.headers, url: req.url, body: req.body });
  for (const [key, value] of Object.entries(result.headers || {})) res.setHeader(key, value);
  res.statusCode = result.status;
  if (result.body === undefined) return res.end();
  return res.end(JSON.stringify(result.body));
}
