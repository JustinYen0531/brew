import { createHash } from 'node:crypto';
import {
  ApiError,
  getSupabaseConfig,
  getVerifiedSupabaseUser,
  readBearerToken,
  supabaseRequest
} from './auth.mjs';

const PERSONAL_KINDS = ['daily', 'manual', 'historical'];
const FEEDBACK_ACTIONS = new Set([
  'starred', 'super_starred', 'unstarred', 'unsuper_starred', 'read', 'unread',
  'not_interested', 'want_more', 'exclude_source', 'want_to_build', 'reviewed', 'skipped'
]);
const SECRET_KEY_PATTERN = /(api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|bearer)/i;
const SECRET_VALUE_PATTERNS = [
  /\bsk-(?:or-v1-|ant-|proj-)?[A-Za-z0-9_-]{12,}/gi,
  /\bsb_secret_[A-Za-z0-9_-]{10,}/gi,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\bBearer\s+[A-Za-z0-9._-]{16,}/gi
];
const DEFAULT_REVIEW_PROMPT = '還記得這個原則解決什麼問題嗎？';

function localDate() {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeDate(value, fallback = localDate()) {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new ApiError('invalid_date', 400, '日期格式必須是 YYYY-MM-DD。');
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    throw new ApiError('invalid_date', 400, '日期格式必須是 YYYY-MM-DD。');
  }
  return raw;
}

function addDays(date, days) {
  const parsed = new Date(`${normalizeDate(date)}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function normalizeKind(value, fallback = 'daily') {
  return PERSONAL_KINDS.includes(value) ? value : fallback;
}

function redactText(value) {
  let result = String(value || '');
  for (const pattern of SECRET_VALUE_PATTERNS) result = result.replace(pattern, '[已移除敏感憑證]');
  return result.slice(0, 12_000);
}

export function sanitizeStoredJson(value, depth = 0) {
  if (depth > 5) return '[內容層級過深]';
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.slice(0, 40).map(item => sanitizeStoredJson(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 80).flatMap(([key, entry]) => {
      if (SECRET_KEY_PATTERN.test(key)) return [];
      return [[String(key).slice(0, 120), sanitizeStoredJson(entry, depth + 1)]];
    }));
  }
  return undefined;
}

function tablePath(config, table, query = {}) {
  const endpoint = new URL(`/rest/v1/${table}`, `${config.url}/`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') endpoint.searchParams.set(key, String(value));
  }
  return `${endpoint.pathname}${endpoint.search}`;
}

function upstreamError(code, message, response) {
  if (response?.status === 401 || response?.status === 403) return new ApiError('auth_invalid', 401, '登入已失效，請重新取得你的晨報。');
  return new ApiError(code, 502, message);
}

async function rest(config, token, table, query, options = {}) {
  const headers = { Authorization: `Bearer ${token}`, ...(options.headers || {}) };
  const result = await supabaseRequest(config, tablePath(config, table, query), { ...options, headers });
  return result;
}

export async function getAuthorizedContext(input = {}) {
  const config = getSupabaseConfig(input.env || process.env);
  const token = readBearerToken(input.headers || {});
  const user = await getVerifiedSupabaseUser(token, config);
  return { config, token, user };
}

export function lessonKeyForItem(item = {}) {
  const explicit = typeof item.lesson_key === 'string' ? item.lesson_key.trim() : '';
  if (explicit && explicit.length <= 240) return explicit;
  const rawUrl = typeof item.url === 'string' ? item.url.trim() : typeof item.source?.url === 'string' ? item.source.url.trim() : '';
  if (rawUrl && /^https?:\/\//i.test(rawUrl)) {
    try {
      const url = new URL(rawUrl);
      url.hash = '';
      url.search = '';
      url.pathname = url.pathname.replace(/\/+$/, '') || '/';
      return `url:${url.toString().toLowerCase()}`.slice(0, 240);
    } catch {}
  }
  const title = typeof item.title === 'string' ? item.title.trim() : '';
  const date = typeof item.date === 'string' ? item.date.trim() : '';
  return `text:${createHash('sha256').update(`${title}\n${date}`).digest('hex').slice(0, 48)}`;
}

function normalizeItem(item = {}, position, asOfDate) {
  const payload = sanitizeStoredJson(item);
  const sourceUrl = typeof item.url === 'string' && /^https?:\/\//i.test(item.url.trim()) ? item.url.trim().slice(0, 1000) : '';
  const publishedAt = typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date) ? item.date : asOfDate;
  return {
    position,
    lesson_key: lessonKeyForItem(item),
    payload,
    source_url: sourceUrl,
    source_platform: String(item.sourceType || item.source || '').slice(0, 160),
    category: String(item.category || '').slice(0, 160),
    difficulty: ['初學者', '普通', '困難'].includes(item.difficulty) ? item.difficulty : '普通',
    published_at: publishedAt
  };
}

function editionToUi(edition, items = []) {
  return {
    id: edition.id,
    run_date: edition.edition_date,
    as_of_date: edition.as_of_date,
    mode: edition.kind,
    kind: edition.kind,
    pot_number: edition.pot_number,
    status: edition.status,
    provider: edition.provider,
    model: edition.model,
    requested_count: edition.requested_count,
    title: edition.title,
    objective: edition.objective,
    generated_at: edition.generated_at,
    generation_run_id: edition.generation_run_id || '',
    generation_recipe: edition.generation_recipe || {},
    items: items.map(item => itemToUi(item, edition.as_of_date))
  };
}

function itemToUi(item, fallbackDate = '') {
  return {
    ...((item.payload && typeof item.payload === 'object') ? item.payload : {}),
    lesson_key: item.lesson_key,
    edition_id: item.edition_id,
    position: item.position,
    url: item.source_url || item.payload?.url || '',
    sourceType: item.source_platform || item.payload?.sourceType || '',
    category: item.category || item.payload?.category || '',
    difficulty: item.difficulty || item.payload?.difficulty || '普通',
    date: item.published_at || item.payload?.date || fallbackDate
  };
}

async function readEditionRows(context, { date, kind, potNumber } = {}) {
  const query = {
    user_id: `eq.${context.user.id}`,
    edition_date: `eq.${normalizeDate(date)}`,
    kind: `eq.${normalizeKind(kind)}`,
    select: '*',
    order: 'pot_number.desc',
    limit: '1'
  };
  if (Number.isInteger(potNumber) && potNumber > 0) query.pot_number = `eq.${potNumber}`;
  const result = await rest(context.config, context.token, 'brew_editions', query);
  if (!result.response.ok || !Array.isArray(result.data)) throw upstreamError('edition_read_failed', '個人晨報暫時無法讀取，請稍後再試。', result.response);
  return result.data;
}

export async function readPersonalEdition(context, options = {}) {
  const rows = await readEditionRows(context, options);
  if (!rows[0]) return null;
  const edition = rows[0];
  const itemsResult = await rest(context.config, context.token, 'brew_edition_items', {
    edition_id: `eq.${edition.id}`,
    select: '*',
    order: 'position.asc'
  });
  if (!itemsResult.response.ok || !Array.isArray(itemsResult.data)) throw upstreamError('edition_items_read_failed', '個人晨報內容暫時無法讀取，請稍後再試。', itemsResult.response);
  return editionToUi(edition, itemsResult.data);
}

export async function listPersonalEditions(context, { month = '' } = {}) {
  const query = {
    user_id: `eq.${context.user.id}`,
    select: 'id,edition_date,as_of_date,kind,pot_number,status,provider,model,requested_count,title,generated_at,generation_run_id,generation_recipe',
    order: 'edition_date.desc,pot_number.desc',
    limit: '100'
  };
  if (month) {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new ApiError('invalid_month', 400, '月份格式必須是 YYYY-MM。');
    const [year, monthNumber] = month.split('-').map(Number);
    if (monthNumber < 1 || monthNumber > 12) throw new ApiError('invalid_month', 400, '月份格式必須是 YYYY-MM。');
    const next = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
    query.and = `(edition_date.gte.${month}-01,edition_date.lt.${next})`;
  }
  const result = await rest(context.config, context.token, 'brew_editions', query);
  if (!result.response.ok || !Array.isArray(result.data)) throw upstreamError('editions_read_failed', '晨報歷史暫時無法讀取，請稍後再試。', result.response);
  return result.data.map(edition => ({
    id: edition.id,
    date: edition.edition_date,
    as_of_date: edition.as_of_date,
    mode: edition.kind,
    pot_number: edition.pot_number,
    status: edition.status,
    count: edition.requested_count,
    title: edition.title,
    generated_at: edition.generated_at,
    has_recipe: Boolean(edition.generation_recipe && Object.keys(edition.generation_recipe).length),
    recipe_version: edition.generation_recipe?.schema_version || '',
    generation_run_id: edition.generation_run_id || ''
  }));
}

export async function listPersonalPantry(context, { limit = 300 } = {}) {
  const editionsResult = await rest(context.config, context.token, 'brew_editions', {
    user_id: `eq.${context.user.id}`,
    select: 'id,edition_date,as_of_date,kind,pot_number',
    order: 'edition_date.desc,pot_number.desc',
    limit: '100'
  });
  if (!editionsResult.response.ok || !Array.isArray(editionsResult.data)) throw upstreamError('pantry_read_failed', '知識儲藏室暫時無法讀取，請稍後再試。', editionsResult.response);
  const editions = editionsResult.data;
  if (!editions.length) return [];
  const editionIds = editions.map(edition => edition.id).filter(isUuid);
  const itemsResult = await rest(context.config, context.token, 'brew_edition_items', {
    edition_id: `in.(${editionIds.join(',')})`,
    select: '*',
    order: 'created_at.desc',
    limit: String(Math.min(500, Math.max(1, Number(limit) || 300)))
  });
  if (!itemsResult.response.ok || !Array.isArray(itemsResult.data)) throw upstreamError('pantry_read_failed', '知識儲藏室內容暫時無法讀取，請稍後再試。', itemsResult.response);
  const editionDates = new Map(editions.map(edition => [edition.id, edition.as_of_date || edition.edition_date]));
  const seen = new Set();
  return itemsResult.data.flatMap(item => {
    if (!item?.lesson_key || seen.has(item.lesson_key)) return [];
    seen.add(item.lesson_key);
    return [itemToUi(item, editionDates.get(item.edition_id) || localDate())];
  });
}

function normalizeEditionInput(input = {}) {
  const runDate = normalizeDate(input.runDate || input.edition?.run_date);
  const asOfDate = normalizeDate(input.asOfDate || input.edition?.as_of_date || runDate);
  const kind = normalizeKind(input.kind || input.edition?.kind || input.edition?.mode);
  const items = Array.isArray(input.items || input.edition?.items) ? (input.items || input.edition.items).slice(0, 15) : [];
  if (!items.length) throw new ApiError('edition_items_missing', 400, '這一壺沒有可保存的內容。');
  return { runDate, asOfDate, kind, items };
}

export async function savePersonalEdition(context, input = {}) {
  const normalized = normalizeEditionInput(input);
  const { runDate, asOfDate, kind, items } = normalized;
  let potNumber = kind === 'daily' ? 1 : Number(input.potNumber || 0);
  if (!Number.isInteger(potNumber) || potNumber < 1) {
    const latest = await rest(context.config, context.token, 'brew_editions', {
      user_id: `eq.${context.user.id}`,
      edition_date: `eq.${runDate}`,
      kind: `eq.${kind}`,
      select: 'pot_number',
      order: 'pot_number.desc',
      limit: '1'
    });
    if (!latest.response.ok || !Array.isArray(latest.data)) throw upstreamError('edition_read_failed', '晨報壺次數暫時無法確認，請稍後再試。', latest.response);
    potNumber = Number(latest.data[0]?.pot_number || 0) + 1;
  }
  const recipe = sanitizeStoredJson(input.generationRecipe || input.edition?.generation_recipe || {});
  const record = {
    user_id: context.user.id,
    edition_date: runDate,
    as_of_date: asOfDate,
    kind,
    pot_number: potNumber,
    status: 'complete',
    provider: String(input.provider || input.edition?.provider || 'openrouter').slice(0, 80),
    model: String(input.model || input.edition?.model || '').slice(0, 160),
    requested_count: Math.min(15, Math.max(1, items.length)),
    title: String(input.title || input.edition?.title || 'Vibe Coding 每日手沖').slice(0, 240),
    objective: redactText(input.objective || input.edition?.objective || ''),
    generation_recipe: recipe,
    generation_run_id: String(input.generationRunId || input.edition?.generation_run_id || '').slice(0, 160) || null,
    generated_at: input.generatedAt || input.edition?.generated_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  const upsert = await rest(context.config, context.token, 'brew_editions', { on_conflict: 'user_id,edition_date,kind,pot_number' }, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(record)
  });
  if (!upsert.response.ok) throw upstreamError('edition_save_failed', '這壺晨報暫時無法保存，請稍後再試。', upsert.response);
  const edition = Array.isArray(upsert.data) ? upsert.data[0] : upsert.data;
  if (!edition?.id) throw new ApiError('edition_save_failed', 502, '這壺晨報保存後沒有收到資料編號。');

  const removed = await rest(context.config, context.token, 'brew_edition_items', { edition_id: `eq.${edition.id}` }, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  if (!removed.response.ok) throw upstreamError('edition_items_save_failed', '晨報內容暫時無法更新，請稍後再試。', removed.response);
  const itemRecords = items.map((item, index) => ({ edition_id: edition.id, ...normalizeItem(item, index + 1, asOfDate) }));
  const inserted = await rest(context.config, context.token, 'brew_edition_items', {}, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(itemRecords)
  });
  if (!inserted.response.ok || !Array.isArray(inserted.data)) throw upstreamError('edition_items_save_failed', '晨報內容暫時無法保存，請稍後再試。', inserted.response);
  return editionToUi(edition, inserted.data);
}

async function readMarks(context, lessonKey = '') {
  const query = {
    user_id: `eq.${context.user.id}`,
    select: 'lesson_key,favorite_state,read_at,review_enabled,last_edition_id,updated_at',
    order: 'updated_at.desc',
    limit: '500'
  };
  if (lessonKey) query.lesson_key = `eq.${lessonKey}`;
  const result = await rest(context.config, context.token, 'brew_item_marks', query);
  if (!result.response.ok || !Array.isArray(result.data)) throw upstreamError('marks_read_failed', '收藏狀態暫時無法讀取，請稍後再試。', result.response);
  return result.data;
}

async function readReviews(context, { lessonKey = '', dueOnly = true } = {}) {
  const query = {
    user_id: `eq.${context.user.id}`,
    status: 'eq.pending',
    select: '*',
    order: 'due_on.asc,created_at.asc',
    limit: '100'
  };
  if (lessonKey) query.lesson_key = `eq.${lessonKey}`;
  if (dueOnly) query.due_on = `lte.${localDate()}`;
  const result = await rest(context.config, context.token, 'brew_review_queue', query);
  if (!result.response.ok || !Array.isArray(result.data)) throw upstreamError('review_read_failed', 'Second Pour 暫時無法讀取，請稍後再試。', result.response);
  return result.data;
}

export async function readPersonalSignals(context, options = {}) {
  const [marks, reviewQueue] = await Promise.all([
    readMarks(context, options.lessonKey || ''),
    readReviews(context, { dueOnly: options.dueOnly !== false, lessonKey: options.lessonKey || '' })
  ]);
  return { marks, review_queue: reviewQueue };
}

export async function readPersonalRecommendationSignals(context) {
  const result = await rest(context.config, context.token, 'brew_feedback_events', {
    user_id: `eq.${context.user.id}`,
    select: 'lesson_key,action,payload,created_at',
    order: 'created_at.desc',
    limit: '100'
  });
  if (!result.response.ok || !Array.isArray(result.data)) throw upstreamError('feedback_read_failed', '晨報回饋暫時無法讀取，請稍後再試。', result.response);
  return result.data.map(event => sanitizeStoredJson(event));
}

async function assertEditionOwnership(context, editionId) {
  if (!editionId) return null;
  if (!isUuid(editionId)) throw new ApiError('invalid_edition_id', 400, '晨報編號格式不正確。');
  const result = await rest(context.config, context.token, 'brew_editions', {
    id: `eq.${editionId}`,
    user_id: `eq.${context.user.id}`,
    select: 'id',
    limit: '1'
  });
  if (!result.response.ok) throw upstreamError('edition_read_failed', '無法確認這篇內容所屬的晨報。', result.response);
  if (!result.data?.[0]) throw new ApiError('edition_not_found', 404, '找不到這篇內容所屬的晨報。');
  return editionId;
}

async function upsertMark(context, record) {
  const result = await rest(context.config, context.token, 'brew_item_marks', { on_conflict: 'user_id,lesson_key' }, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(record)
  });
  if (!result.response.ok) throw upstreamError('mark_save_failed', '收藏狀態暫時無法保存，請稍後再試。', result.response);
  return Array.isArray(result.data) ? result.data[0] : result.data;
}

async function appendFeedback(context, record) {
  const result = await rest(context.config, context.token, 'brew_feedback_events', {}, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(record)
  });
  if (!result.response.ok) throw upstreamError('feedback_save_failed', '這次回饋暫時無法保存，請稍後再試。', result.response);
}

async function clearPendingReviews(context, lessonKey) {
  const result = await rest(context.config, context.token, 'brew_review_queue', {
    user_id: `eq.${context.user.id}`,
    lesson_key: `eq.${lessonKey}`,
    status: 'eq.pending'
  }, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  if (!result.response.ok) throw upstreamError('review_save_failed', 'Second Pour 暫時無法更新，請稍後再試。', result.response);
}

async function scheduleReviews(context, { lessonKey, editionId, favoriteState, read, reviewEnabled, sourceSnapshot }) {
  if (!reviewEnabled || favoriteState === 0 && !read) return;
  await clearPendingReviews(context, lessonKey);
  const intervals = favoriteState === 2 ? [3, 14, 45] : favoriteState === 1 ? [7] : [30];
  const records = intervals.map((interval, index) => ({
    user_id: context.user.id,
    lesson_key: lessonKey,
    edition_id: editionId || null,
    due_on: addDays(localDate(), interval),
    interval_days: interval,
    repetition: index + 1,
    status: 'pending',
    prompt: DEFAULT_REVIEW_PROMPT,
    source_snapshot: sanitizeStoredJson(sourceSnapshot || {})
  }));
  const result = await rest(context.config, context.token, 'brew_review_queue', {}, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(records)
  });
  if (!result.response.ok || !Array.isArray(result.data)) throw upstreamError('review_save_failed', 'Second Pour 暫時無法排入複習，請稍後再試。', result.response);
}

async function updateReviewStatus(context, lessonKey, status) {
  const pending = await readReviews(context, { lessonKey, dueOnly: false });
  const row = pending[0];
  if (!row) return;
  const result = await rest(context.config, context.token, 'brew_review_queue', { id: `eq.${row.id}` }, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ status, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
  });
  if (!result.response.ok) throw upstreamError('review_save_failed', 'Second Pour 狀態暫時無法更新，請稍後再試。', result.response);
}

function normalizeFeedbackBody(body = {}) {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const lessonKey = typeof source.lesson_key === 'string' ? source.lesson_key.trim().slice(0, 240) : lessonKeyForItem(source.item || source);
  if (!lessonKey) throw new ApiError('lesson_key_missing', 400, '這篇內容缺少可辨識的編號。');
  const action = typeof source.action === 'string' ? source.action.trim() : '';
  if (!FEEDBACK_ACTIONS.has(action)) throw new ApiError('invalid_feedback_action', 400, '不支援這個晨報回饋動作。');
  const editionId = typeof source.edition_id === 'string' ? source.edition_id.trim() : '';
  return {
    lessonKey,
    action,
    editionId,
    reviewEnabled: source.review_enabled !== false && source.reviewEnabled !== false,
    sourceSnapshot: source.source_snapshot || source.item || {},
    payload: sanitizeStoredJson(source.payload || {})
  };
}

export async function saveFeedback(context, body = {}) {
  const input = normalizeFeedbackBody(body);
  const editionId = await assertEditionOwnership(context, input.editionId);
  const existing = (await readMarks(context, input.lessonKey))[0] || null;
  let favoriteState = Number(existing?.favorite_state || 0);
  let mark = existing;
  const markAction = ['starred', 'super_starred', 'unstarred', 'unsuper_starred', 'read', 'unread', 'not_interested', 'reviewed'].includes(input.action);
  if (input.action === 'starred') favoriteState = 1;
  if (input.action === 'super_starred') favoriteState = 2;
  if (input.action === 'unstarred') favoriteState = 0;
  if (input.action === 'unsuper_starred') favoriteState = 1;
  if (input.action === 'not_interested') favoriteState = 0;
  if (markAction) {
    mark = await upsertMark(context, {
      user_id: context.user.id,
      lesson_key: input.lessonKey,
      favorite_state: favoriteState,
      read_at: ['read', 'reviewed'].includes(input.action) ? new Date().toISOString() : input.action === 'unread' ? null : existing?.read_at || null,
      review_enabled: input.action === 'not_interested' ? false : input.reviewEnabled,
      last_edition_id: editionId,
      updated_at: new Date().toISOString()
    });
  }
  await appendFeedback(context, {
    user_id: context.user.id,
    lesson_key: input.lessonKey,
    edition_id: editionId,
    action: input.action,
    payload: sanitizeStoredJson({ ...input.payload, source_snapshot: input.sourceSnapshot, favorite_state: favoriteState })
  });
  if (input.action === 'starred' || input.action === 'super_starred' || input.action === 'read') {
    await scheduleReviews(context, {
      lessonKey: input.lessonKey,
      editionId,
      favoriteState,
      read: input.action === 'read',
      reviewEnabled: input.reviewEnabled,
      sourceSnapshot: input.sourceSnapshot
    });
  } else if (input.action === 'unstarred' || input.action === 'unsuper_starred' || input.action === 'not_interested') {
    await clearPendingReviews(context, input.lessonKey);
  } else if (input.action === 'reviewed') {
    await updateReviewStatus(context, input.lessonKey, 'completed');
  } else if (input.action === 'skipped') {
    await updateReviewStatus(context, input.lessonKey, 'skipped');
  }
  return { mark, review_queue: await readReviews(context, { lessonKey: input.lessonKey, dueOnly: false }) };
}
