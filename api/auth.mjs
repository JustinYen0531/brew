const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const AUTH_CACHE_CONTROL = 'private,no-store';

export class ApiError extends Error {
  constructor(code, status, safeMessage) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.safeMessage = safeMessage;
  }
}

function headerValue(headers = {}, name) {
  const value = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  if (Array.isArray(value)) return value[0] || '';
  return typeof value === 'string' ? value.trim() : '';
}

function firstForwardedValue(value) {
  return value.split(',')[0].trim();
}

export function getSupabaseConfig(env = process.env) {
  const rawUrl = typeof env.SUPABASE_URL === 'string' ? env.SUPABASE_URL.trim() : '';
  const publishableKey = (typeof env.SUPABASE_PUBLISHABLE_KEY === 'string' && env.SUPABASE_PUBLISHABLE_KEY.trim())
    || (typeof env.SUPABASE_ANON_KEY === 'string' && env.SUPABASE_ANON_KEY.trim())
    || '';
  if (!rawUrl || !publishableKey) throw new ApiError('supabase_config_missing', 503, '登入服務尚未設定。');

  let url;
  try {
    url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported_protocol');
  } catch {
    throw new ApiError('supabase_config_invalid', 503, '登入服務尚未設定。');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return { url: url.toString().replace(/\/$/, ''), key: publishableKey };
}

export function requestOriginInfo({ headers = {}, url = '' } = {}) {
  const forwardedProto = firstForwardedValue(headerValue(headers, 'x-forwarded-proto'));
  const protocol = forwardedProto || (headerValue(headers, 'x-forwarded-ssl') === 'on' ? 'https' : 'http');
  const forwardedHost = firstForwardedValue(headerValue(headers, 'x-forwarded-host'));
  const host = forwardedHost || headerValue(headers, 'host');
  if (!host || !['http', 'https'].includes(protocol)) throw new ApiError('origin_unavailable', 400, '無法確認目前網站來源。');

  let requestOrigin;
  try {
    const requestUrl = new URL(url || '/', `${protocol}://${host}`);
    if (requestUrl.username || requestUrl.password) throw new Error('invalid_host');
    requestOrigin = requestUrl.origin;
  } catch {
    throw new ApiError('origin_unavailable', 400, '無法確認目前網站來源。');
  }

  const incomingOrigin = headerValue(headers, 'origin');
  let browserOrigin = '';
  if (incomingOrigin) {
    try {
      browserOrigin = new URL(incomingOrigin).origin;
    } catch {
      throw new ApiError('cross_origin', 403, '只接受同一網站的請求。');
    }
    if (browserOrigin !== requestOrigin) throw new ApiError('cross_origin', 403, '只接受同一網站的請求。');
  }
  return { requestOrigin, browserOrigin, redirectTo: `${requestOrigin}/` };
}

export function apiResponseHeaders(originInfo = {}) {
  const headers = {
    'Content-Type': JSON_CONTENT_TYPE,
    'Cache-Control': AUTH_CACHE_CONTROL,
    'X-Content-Type-Options': 'nosniff'
  };
  if (originInfo.browserOrigin) {
    headers['Access-Control-Allow-Origin'] = originInfo.browserOrigin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
    headers.Vary = 'Origin';
  }
  return headers;
}

export function readBearerToken(headers = {}) {
  const authorization = headerValue(headers, 'authorization');
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) throw new ApiError('auth_required', 401, '請先登入再使用這項功能。');
  return match[1];
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

export async function supabaseRequest(config, path, options = {}) {
  const target = new URL(path, `${config.url}/`);
  const headers = {
    apikey: config.key,
    Accept: 'application/json',
    ...options.headers
  };
  let response;
  try {
    response = await fetch(target, {
      ...options,
      headers,
      signal: options.signal || AbortSignal.timeout(15_000)
    });
  } catch {
    throw new ApiError('supabase_network', 502, '登入服務暫時無法回應，請稍後再試。');
  }

  const text = await response.text().catch(() => '');
  let data = null;
  if (text) {
    try { data = JSON.parse(text); }
    catch { data = null; }
  }
  return { response, data };
}

function authUpstreamError(response, operation) {
  if (response.status === 401 || response.status === 403) {
    return new ApiError('auth_invalid', 401, '登入已失效，請重新取得登入連結。');
  }
  const message = operation === 'user'
    ? '登入服務暫時無法驗證使用者，請稍後再試。'
    : '登入服務暫時無法回應，請稍後再試。';
  return new ApiError('supabase_upstream', 502, message);
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function getVerifiedSupabaseUser(token, config) {
  const { response, data } = await supabaseRequest(config, '/auth/v1/user', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw authUpstreamError(response, 'user');
  const user = data?.user && typeof data.user === 'object' ? data.user : data;
  if (!user || !isUuid(user.id)) throw new ApiError('auth_invalid', 401, '登入已失效，請重新取得登入連結。');
  return user;
}

function sessionResponse(data) {
  if (!data || typeof data !== 'object') throw new ApiError('supabase_upstream', 502, '登入服務暫時無法回應，請稍後再試。');
  const allowed = ['access_token', 'refresh_token', 'expires_in', 'expires_at', 'token_type', 'user'];
  const session = Object.fromEntries(allowed.filter(key => data[key] !== undefined).map(key => [key, data[key]]));
  if (!session.access_token || !session.refresh_token) throw new ApiError('supabase_upstream', 502, '登入服務暫時無法回應，請稍後再試。');
  return session;
}

async function requestMagicLink(body, originInfo, config) {
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError('invalid_email', 400, '請輸入有效的電子郵件地址。');
  }
  const endpoint = new URL('/auth/v1/otp', `${config.url}/`);
  endpoint.searchParams.set('redirect_to', originInfo.redirectTo);
  const { response } = await supabaseRequest(config, `${endpoint.pathname}${endpoint.search}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, create_user: true })
  });
  if (!response.ok) throw authUpstreamError(response, 'otp');
  return { status: 200, body: { ok: true, message: '登入連結已寄出，請到信箱收下這壺晨光。' } };
}

async function refreshSession(body, config) {
  const refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token.trim() : '';
  if (!refreshToken || refreshToken.length > 4096) throw new ApiError('invalid_refresh_token', 400, '登入資訊格式不正確，請重新取得登入連結。');
  const { response, data } = await supabaseRequest(config, '/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken })
  });
  if (!response.ok) throw authUpstreamError(response, 'refresh');
  return { status: 200, body: sessionResponse(data) };
}

async function signOut(headers, config) {
  const token = readBearerToken(headers);
  const { response } = await supabaseRequest(config, '/auth/v1/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw authUpstreamError(response, 'sign_out');
  return { status: 200, body: { ok: true, message: '這壺晨報已收好。' } };
}

async function authApiOrThrow(input) {
  const originInfo = requestOriginInfo(input);
  const headers = apiResponseHeaders(originInfo);
  if (input.method === 'OPTIONS') return { status: 204, body: undefined, headers };
  const config = getSupabaseConfig(input.env || process.env);
  if (input.method === 'GET') {
    const token = readBearerToken(input.headers);
    const user = await getVerifiedSupabaseUser(token, config);
    return { status: 200, body: { user }, headers };
  }
  if (input.method !== 'POST') throw new ApiError('method_not_allowed', 405, '這個登入入口不接受目前的請求方式。');

  const body = normalizeBody(input.body);
  if (body.action === 'request_link') return { ...(await requestMagicLink(body, originInfo, config)), headers };
  if (body.action === 'refresh') return { ...(await refreshSession(body, config)), headers };
  if (body.action === 'sign_out') return { ...(await signOut(input.headers, config)), headers };
  throw new ApiError('unknown_action', 400, '不支援的登入操作。');
}

function errorResponse(error, originInfo = {}) {
  const known = error instanceof ApiError;
  const status = known ? error.status : 500;
  const message = known ? error.safeMessage : '登入服務暫時無法使用，請稍後再試。';
  return { status, body: { error: message }, headers: apiResponseHeaders(originInfo) };
}

export async function authApi(input = {}) {
  let originInfo = {};
  try { originInfo = requestOriginInfo(input); }
  catch (error) { return errorResponse(error); }
  try { return await authApiOrThrow({ ...input, originInfo }); }
  catch (error) { return errorResponse(error, originInfo); }
}

export default async function handler(req, res) {
  const result = await authApi({ method: req.method, headers: req.headers, url: req.url, body: req.body });
  for (const [key, value] of Object.entries(result.headers || {})) res.setHeader(key, value);
  res.statusCode = result.status;
  if (result.body === undefined) return res.end();
  return res.end(JSON.stringify(result.body));
}
