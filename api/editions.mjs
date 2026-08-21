import { ApiError, apiResponseHeaders, requestOriginInfo } from './auth.mjs';
import { getAuthorizedContext, listPersonalEditions } from './edition-storage.mjs';

function queryParams(input) {
  try { return new URL(input.url || '/', 'http://localhost').searchParams; }
  catch { return new URLSearchParams(); }
}

function errorResponse(error, originInfo = {}) {
  const known = error instanceof ApiError;
  return {
    status: known ? error.status : 500,
    body: { error: known ? error.safeMessage : '晨報歷史暫時無法讀取，請稍後再試。' },
    headers: apiResponseHeaders(originInfo)
  };
}

export async function editionsApi(input = {}) {
  let originInfo = {};
  try { originInfo = requestOriginInfo(input); }
  catch (error) { return errorResponse(error); }
  const headers = apiResponseHeaders(originInfo);
  try {
    if (input.method === 'OPTIONS') return { status: 204, body: undefined, headers };
    if (input.method !== 'GET') throw new ApiError('method_not_allowed', 405, '晨報歷史入口只接受 GET。');
    const context = await getAuthorizedContext(input);
    const dates = await listPersonalEditions(context, { month: queryParams(input).get('month') || '' });
    return { status: 200, body: { dates }, headers };
  } catch (error) {
    return errorResponse(error, originInfo);
  }
}

export default async function handler(req, res) {
  const result = await editionsApi({ method: req.method, headers: req.headers, url: req.url, env: process.env });
  for (const [key, value] of Object.entries(result.headers || {})) res.setHeader(key, value);
  res.statusCode = result.status;
  if (result.body === undefined) return res.end();
  return res.end(JSON.stringify(result.body));
}
