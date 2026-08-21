import {
  ApiError,
  apiResponseHeaders,
  getSupabaseConfig,
  getVerifiedSupabaseUser,
  readBearerToken,
  requestOriginInfo,
  supabaseRequest
} from './auth.mjs';

const NICKNAME_MAX_LENGTH = 32;

export function sanitizeNickname(raw = {}) {
  const source = raw?.profile && typeof raw.profile === 'object' && !Array.isArray(raw.profile) ? raw.profile : raw;
  const nickname = typeof source?.nickname === 'string' ? source.nickname.trim().replace(/\s+/g, ' ') : '';
  if (!nickname || nickname.length > NICKNAME_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(nickname)) {
    throw new ApiError('invalid_nickname', 400, `請輸入 1 到 ${NICKNAME_MAX_LENGTH} 個字的晨報稱呼。`);
  }
  return nickname;
}

function profileUpstreamError(response) {
  if (response.status === 401 || response.status === 403) return new ApiError('auth_invalid', 401, '登入已失效，請重新取得你的晨報。');
  return new ApiError('profile_upstream', 502, '晨報稱呼暫時無法讀取或保存，請稍後再試。');
}

async function readProfile(user, token, config) {
  const endpoint = new URL('/rest/v1/brew_profiles', `${config.url}/`);
  endpoint.searchParams.set('user_id', `eq.${user.id}`);
  endpoint.searchParams.set('select', 'user_id,nickname,created_at,updated_at');
  const { response, data } = await supabaseRequest(config, `${endpoint.pathname}${endpoint.search}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw profileUpstreamError(response);
  if (!Array.isArray(data)) throw new ApiError('profile_upstream', 502, '晨報稱呼暫時無法讀取，請稍後再試。');
  return data[0] || null;
}

async function saveProfile(user, token, config, raw) {
  const nickname = sanitizeNickname(raw);
  const record = { user_id: user.id, nickname, updated_at: new Date().toISOString() };
  const endpoint = new URL('/rest/v1/brew_profiles', `${config.url}/`);
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
  if (!response.ok) throw profileUpstreamError(response);
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
    body: { error: known ? error.safeMessage : '晨報稱呼服務暫時無法使用，請稍後再試。' },
    headers: apiResponseHeaders(originInfo)
  };
}

export async function profileApi(input = {}) {
  let originInfo = {};
  try { originInfo = requestOriginInfo(input); }
  catch (error) { return errorResponse(error); }
  const headers = apiResponseHeaders(originInfo);
  try {
    if (input.method === 'OPTIONS') return { status: 204, body: undefined, headers };
    if (!['GET', 'PUT'].includes(input.method)) throw new ApiError('method_not_allowed', 405, '這個晨報稱呼入口不接受目前的請求方式。');
    const config = getSupabaseConfig(input.env || process.env);
    const token = readBearerToken(input.headers);
    const user = await getVerifiedSupabaseUser(token, config);
    if (input.method === 'GET') return { status: 200, body: { profile: await readProfile(user, token, config) }, headers };
    const saved = await saveProfile(user, token, config, normalizeBody(input.body));
    return { status: 200, body: { profile: saved }, headers };
  } catch (error) {
    return errorResponse(error, originInfo);
  }
}

export default async function handler(req, res) {
  const result = await profileApi({ method: req.method, headers: req.headers, url: req.url, body: req.body });
  for (const [key, value] of Object.entries(result.headers || {})) res.setHeader(key, value);
  res.statusCode = result.status;
  if (result.body === undefined) return res.end();
  return res.end(JSON.stringify(result.body));
}
