import { ApiError, apiResponseHeaders, requestOriginInfo } from './auth.mjs';
import { getAuthorizedContext, listPersonalPantry } from './edition-storage.mjs';

function errorResponse(error, originInfo = {}) {
  const known = error instanceof ApiError;
  return {
    status: known ? error.status : 500,
    body: { error: known ? error.safeMessage : '知識儲藏室暫時無法讀取，請稍後再試。' },
    headers: apiResponseHeaders(originInfo)
  };
}

export async function pantryApi(input = {}) {
  let originInfo = {};
  try { originInfo = requestOriginInfo(input); }
  catch (error) { return errorResponse(error); }
  const headers = apiResponseHeaders(originInfo);
  try {
    if (input.method === 'OPTIONS') return { status: 204, body: undefined, headers };
    if (input.method !== 'GET') throw new ApiError('method_not_allowed', 405, '知識儲藏室入口只接受 GET。');
    const context = await getAuthorizedContext(input);
    return { status: 200, body: { items: await listPersonalPantry(context) }, headers };
  } catch (error) {
    return errorResponse(error, originInfo);
  }
}

export default async function handler(req, res) {
  const result = await pantryApi({ method: req.method, headers: req.headers, url: req.url, env: process.env });
  for (const [key, value] of Object.entries(result.headers || {})) res.setHeader(key, value);
  res.statusCode = result.status;
  if (result.body === undefined) return res.end();
  return res.end(JSON.stringify(result.body));
}
