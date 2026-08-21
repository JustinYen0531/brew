import { ApiError, apiResponseHeaders, requestOriginInfo } from './auth.mjs';
import { getAuthorizedContext, readPersonalSignals, saveFeedback } from './edition-storage.mjs';

function queryParams(input) {
  try { return new URL(input.url || '/', 'http://localhost').searchParams; }
  catch { return new URLSearchParams(); }
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
    body: { error: known ? error.safeMessage : '晨報回饋暫時無法保存，請稍後再試。' },
    headers: apiResponseHeaders(originInfo)
  };
}

export async function feedbackApi(input = {}) {
  let originInfo = {};
  try { originInfo = requestOriginInfo(input); }
  catch (error) { return errorResponse(error); }
  const headers = apiResponseHeaders(originInfo);
  try {
    if (input.method === 'OPTIONS') return { status: 204, body: undefined, headers };
    if (!['GET', 'POST'].includes(input.method)) throw new ApiError('method_not_allowed', 405, '晨報回饋入口不接受目前的請求方式。');
    const context = await getAuthorizedContext(input);
    if (input.method === 'GET') {
      const params = queryParams(input);
      const signals = await readPersonalSignals(context, {
        lessonKey: params.get('lesson_key') || '',
        dueOnly: params.get('all') !== 'true'
      });
      return { status: 200, body: signals, headers };
    }
    return { status: 200, body: await saveFeedback(context, normalizeBody(input.body)), headers };
  } catch (error) {
    return errorResponse(error, originInfo);
  }
}

export default async function handler(req, res) {
  const result = await feedbackApi({ method: req.method, headers: req.headers, url: req.url, body: req.body, env: process.env });
  for (const [key, value] of Object.entries(result.headers || {})) res.setHeader(key, value);
  res.statusCode = result.status;
  if (result.body === undefined) return res.end();
  return res.end(JSON.stringify(result.body));
}
