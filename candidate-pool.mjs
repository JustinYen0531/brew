import { createHash } from 'node:crypto';

export const CANDIDATE_POOL_VERSION = 'candidate-pool-v1';

const DIFFICULTIES = ['初學者', '普通', '困難'];
const PLACEHOLDER_HOSTS = new Set(['example.com', 'example.org', 'example.net', 'localhost', 'invalid']);
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'into', 'using', 'how', 'what',
  '的', '了', '與', '和', '在', '用', '一個', '這個', '如何', '以及', '可以'
]);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalized(value) {
  return text(value).toLocaleLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
}

function searchable(value) {
  return text(value).toLocaleLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ');
}

function dateOnly(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const raw = value.trim();
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  const result = parsed.toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw) && result !== raw) return '';
  return result;
}

function canonicalUrl(value) {
  try {
    const url = new URL(text(value));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    if (!url.hostname || PLACEHOLDER_HOSTS.has(url.hostname.toLowerCase())) return '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|ref$|source$|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    }
    url.pathname = url.pathname.replace(/\/{2,}/g, '/');
    return url.toString().replace(/\/$/, '') || url.origin;
  } catch {
    return '';
  }
}

function hostname(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return ''; }
}

function pathWithin(candidateUrl, baseUrl) {
  const candidate = canonicalUrl(candidateUrl);
  const base = canonicalUrl(baseUrl);
  if (!candidate || !base) return false;
  const candidateObject = new URL(candidate);
  const baseObject = new URL(base);
  if (candidateObject.hostname !== baseObject.hostname) return false;
  const basePath = baseObject.pathname.replace(/\/$/, '') || '/';
  const candidatePath = candidateObject.pathname.replace(/\/$/, '') || '/';
  return basePath === '/' || candidatePath === basePath || candidatePath.startsWith(`${basePath}/`);
}

function tokenize(value) {
  const source = searchable(value);
  const words = source.split(/\s+/).filter(Boolean).filter(word => !STOP_WORDS.has(word));
  const compact = normalized(value);
  const grams = [];
  for (let index = 0; index < compact.length - 1; index += 1) grams.push(compact.slice(index, index + 2));
  return new Set([...words, ...grams].filter(Boolean));
}

function overlap(left, right) {
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.max(1, Math.min(left.size, right.size));
}

function jaccard(left, right) {
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.max(1, left.size + right.size - shared);
}

function sourceText(candidate) {
  return [candidate.sourceType, candidate.source, candidate.url].filter(Boolean).join(' ');
}

function sourceMatches(candidate, value) {
  const needle = normalized(value);
  if (!needle) return false;
  const haystack = normalized(sourceText(candidate));
  if (haystack.includes(needle)) return true;
  try {
    const candidateHost = hostname(candidate.url);
    const valueHost = hostname(value);
    return Boolean(candidateHost && valueHost && candidateHost === valueHost);
  } catch { return false; }
}

function sourceFamily(candidate) {
  const host = hostname(candidate.url);
  if (host.includes('github')) return 'github';
  if (host.includes('reddit')) return 'reddit';
  if (host.includes('facebook')) return 'facebook';
  return normalized(candidate.sourceType || host || candidate.source || 'unknown') || 'unknown';
}

function sourceWeight(candidate, preferences) {
  const weights = preferences?.sourceWeights && typeof preferences.sourceWeights === 'object' ? preferences.sourceWeights : {};
  const family = sourceFamily(candidate);
  const direct = Number(weights[family]);
  if (Number.isFinite(direct)) return Math.min(5, Math.max(1, direct));
  for (const [key, value] of Object.entries(weights)) {
    if (sourceMatches(candidate, key)) return Math.min(5, Math.max(1, Number(value) || 3));
  }
  const selectedSources = [...(preferences?.selectedSources || []), ...(preferences?.customSources || [])];
  if (selectedSources.some(source => sourceMatches(candidate, source?.url || '') || sourceMatches(candidate, source?.name || '') || sourceMatches(candidate, source?.platform || ''))) return 5;
  const selectedIds = Array.isArray(preferences?.selectedSourceIds) ? preferences.selectedSourceIds : [];
  if (selectedIds.some(id => sourceMatches(candidate, id))) return 5;
  return 3;
}

function candidateText(candidate) {
  return [candidate.title, candidate.category, candidate.takeaway, candidate.problem, candidate.principle, candidate.tryIt, candidate.tradeoffs, candidate.sourceType].filter(Boolean).join(' ');
}

function topicScore(candidate, preferences) {
  const topics = Array.isArray(preferences?.topics) ? preferences.topics.filter(Boolean) : [];
  if (!topics.length) return 0;
  const haystack = normalized(candidateText(candidate));
  const topicWeights = preferences?.topicWeights || preferences?.topic_weights || {};
  const matchedTopics = topics.filter(topic => haystack.includes(normalized(topic)));
  if (!matchedTopics.length) return -0.4;
  const averageWeight = matchedTopics.reduce((sum, topic) => {
    const weight = Number(topicWeights[topic]);
    return sum + (Number.isFinite(weight) ? Math.min(5, Math.max(1, weight)) : 3);
  }, 0) / matchedTopics.length;
  return Math.min(2.8, 0.6 + matchedTopics.length * 0.45 + averageWeight * 0.18);
}

function contentStyleScore(candidate, preferences) {
  const styles = Array.isArray(preferences?.contentStyles) ? preferences.contentStyles.filter(Boolean) : [];
  if (!styles.length) return 0;
  const haystack = normalized(candidateText(candidate));
  return styles.some(style => haystack.includes(normalized(style))) ? 0.7 : 0;
}

function recencyScore(candidate, asOfDate, noveltyLevel = 3) {
  const published = dateOnly(candidate.date);
  const asOf = dateOnly(asOfDate);
  if (!published || !asOf) return 0;
  const age = Math.max(0, Math.round((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${published}T00:00:00Z`)) / 86_400_000));
  const freshness = 5 * Math.exp(-age / 45);
  const preference = Math.min(5, Math.max(1, Number(noveltyLevel) || 3));
  return ((freshness - 2.5) * (preference - 3)) / 2.5;
}

function feedbackSignals(candidate, preferences) {
  const signals = Array.isArray(preferences?.feedbackSignals) ? preferences.feedbackSignals : [];
  const candidateFamily = sourceFamily(candidate);
  const candidateTokens = tokenize(candidateText(candidate));
  const matching = [];
  let score = 0;
  let hardExcluded = false;
  for (const signal of signals) {
    const action = text(signal?.action);
    const snapshot = signal?.payload?.source_snapshot || signal?.payload || {};
    const snapshotFamily = sourceFamily({
      sourceType: snapshot.sourceType || snapshot.source_type || snapshot.source,
      source: snapshot.source,
      url: snapshot.url || snapshot.source_url
    });
    const snapshotUrl = canonicalUrl(snapshot.url || snapshot.source_url);
    const exact = snapshotUrl && snapshotUrl === canonicalUrl(candidate.url);
    const sameFamily = candidateFamily !== 'unknown' && candidateFamily === snapshotFamily;
    const similar = overlap(candidateTokens, tokenize([snapshot.title, snapshot.category, snapshot.difficulty, snapshot.principle].filter(Boolean).join(' '))) >= 0.28;
    if (!(exact || sameFamily || similar)) continue;
    matching.push(action);
    if (action === 'super_starred') score += exact ? 4 : 3;
    if (action === 'starred') score += exact ? 2.5 : 1.5;
    if (action === 'want_more' || action === 'want_to_build') score += 1.5;
    if (action === 'not_interested') score -= exact ? 6 : 3;
    if (action === 'exclude_source' && sameFamily) { score -= 8; hardExcluded = true; }
    if (action === 'unstarred' || action === 'unsuper_starred') score -= 0.5;
  }
  return { score, matching, hardExcluded };
}

function difficultyScore(candidate, preferences) {
  const levels = Array.isArray(preferences?.difficultyLevels) ? preferences.difficultyLevels : [];
  if (!levels.length) return 0;
  return levels.includes(candidate.difficulty) ? 1.2 : -2;
}

function baseScore(candidate, asOfDate) {
  const age = Math.max(0, Math.round((Date.parse(`${asOfDate}T00:00:00Z`) - Date.parse(`${candidate.date}T00:00:00Z`)) / 86_400_000));
  const recency = 5 * Math.exp(-age / 30);
  return 0.52 * recency + 0.25 * Number(candidate.importance || 3) + 0.13 * Number(candidate.timeless || 3) + 0.10 * Number(candidate.heat || 2);
}

function hardRejectReason(candidate, preferences, asOfDate) {
  if (!candidate || typeof candidate !== 'object') return 'candidate_missing';
  const url = canonicalUrl(candidate.url);
  if (!url) return 'url_invalid';
  if (dateOnly(candidate.date) !== candidate.date) return 'published_date_invalid';
  if (candidate.date > asOfDate) return 'published_after_cutoff';
  if (!text(candidate.title) || !text(candidate.category) || !text(candidate.evidence)) return 'required_evidence_missing';
  if (/^(unknown|unavailable|n\/a|無法取得|未提供)$/i.test(text(candidate.evidence))) return 'required_evidence_missing';
  const excluded = Array.isArray(preferences?.excludedTopics) ? preferences.excludedTopics : [];
  const searchableCandidate = normalized(candidateText(candidate));
  if (excluded.some(topic => normalized(topic) && searchableCandidate.includes(normalized(topic)))) return 'excluded_topic';
  const levels = Array.isArray(preferences?.difficultyLevels) ? preferences.difficultyLevels : [];
  if (levels.length && !levels.includes(candidate.difficulty)) return 'difficulty_not_selected';
  const directUrls = Array.isArray(preferences?.directUrls) ? preferences.directUrls : [];
  if (directUrls.length && !directUrls.some(base => pathWithin(url, base))) return 'outside_hard_url_scope';
  const feedback = feedbackSignals(candidate, preferences);
  if (feedback.hardExcluded) return 'excluded_by_feedback';
  return '';
}

function normalizeCandidate(item, index) {
  const url = canonicalUrl(item?.url);
  const date = dateOnly(item?.date);
  const title = text(item?.title);
  const lessonKey = url ? `url:${url}`.slice(0, 240) : `text:${createHash('sha256').update(`${title}\n${date}`).digest('hex').slice(0, 48)}`;
  return {
    item,
    index,
    lessonKey,
    url,
    date,
    title,
    category: text(item?.category),
    difficulty: DIFFICULTIES.includes(item?.difficulty) ? item.difficulty : '普通',
    evidence: text(item?.evidence),
    sourceType: text(item?.sourceType),
    source: text(item?.source),
    tryIt: text(item?.tryIt),
    takeaway: text(item?.takeaway),
    problem: text(item?.problem),
    principle: text(item?.principle),
    tradeoffs: text(item?.tradeoffs),
    importance: Number(item?.importance) || 3,
    timeless: Number(item?.timeless) || 3,
    heat: Number(item?.heat) || 2
  };
}

function scoreCandidate(candidate, preferences, asOfDate) {
  const feedback = feedbackSignals(candidate, preferences);
  const weight = sourceWeight(candidate, preferences);
  const breakdown = {
    curator_base: Number(baseScore(candidate, asOfDate).toFixed(3)),
    topic_match: Number(topicScore(candidate, preferences).toFixed(3)),
    source_preference: Number(((weight - 3) * 0.55).toFixed(3)),
    difficulty_match: Number(difficultyScore(candidate, preferences).toFixed(3)),
    content_style_match: Number(contentStyleScore(candidate, preferences).toFixed(3)),
    novelty: Number(recencyScore(candidate, asOfDate, preferences?.noveltyLevel).toFixed(3)),
    feedback: Number(feedback.score.toFixed(3))
  };
  const score = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  return { score: Number(score.toFixed(3)), breakdown, sourceWeight: weight, feedbackMatches: feedback.matching };
}

function duplicateConcept(candidate, selected) {
  const tokens = tokenize(candidate.title);
  return selected.some(previous => {
    if (previous.lessonKey === candidate.lessonKey || previous.url === candidate.url) return true;
    const titleOverlap = overlap(tokens, tokenize(previous.title));
    const bodyOverlap = jaccard(tokenize(candidate.principle), tokenize(previous.principle));
    return titleOverlap >= 0.72 || bodyOverlap >= 0.82;
  });
}

export function filterAndRankCandidates(items, preferences = {}, asOfDate, { count = items?.length || 0 } = {}) {
  const input = Array.isArray(items) ? items : [];
  const rejected = {};
  const eligible = [];
  const seenUrls = new Set();
  const seenLessons = new Set();
  for (const [index, item] of input.entries()) {
    const candidate = normalizeCandidate(item, index);
    const reason = hardRejectReason(candidate, preferences, asOfDate);
    if (reason) {
      rejected[reason] = (rejected[reason] || 0) + 1;
      continue;
    }
    if (seenUrls.has(candidate.url)) {
      rejected.duplicate_source_url = (rejected.duplicate_source_url || 0) + 1;
      continue;
    }
    if (seenLessons.has(candidate.lessonKey)) {
      rejected.duplicate_lesson = (rejected.duplicate_lesson || 0) + 1;
      continue;
    }
    seenUrls.add(candidate.url);
    seenLessons.add(candidate.lessonKey);
    const scoring = scoreCandidate(candidate, preferences, asOfDate);
    eligible.push({ ...candidate, ...scoring });
  }

  eligible.sort((left, right) => right.score - left.score || right.date.localeCompare(left.date) || left.url.localeCompare(right.url));
  const selected = [];
  const sourceCounts = new Map();
  const choose = (candidate, preferNewSource) => {
    if (selected.length >= count || duplicateConcept(candidate, selected)) {
      if (duplicateConcept(candidate, selected)) rejected.duplicate_concept = (rejected.duplicate_concept || 0) + 1;
      return;
    }
    const family = sourceFamily(candidate);
    if (preferNewSource && sourceCounts.has(family)) return;
    selected.push(candidate);
    sourceCounts.set(family, (sourceCounts.get(family) || 0) + 1);
  };
  for (const candidate of eligible) choose(candidate, true);
  for (const candidate of eligible) choose(candidate, false);

  if (selected.length < count) {
    throw Object.assign(new Error('candidate_pool_insufficient'), {
      status: 502,
      candidatePool: buildSnapshot({ input, eligible, selected, rejected, count, asOfDate })
    });
  }
  return {
    items: selected.map((candidate, index) => ({ ...candidate.item, n: String(index + 1).padStart(2, '0') })),
    snapshot: buildSnapshot({ input, eligible, selected, rejected, count, asOfDate })
  };
}

function buildSnapshot({ input, eligible, selected, rejected, count, asOfDate }) {
  return {
    version: CANDIDATE_POOL_VERSION,
    as_of_date: asOfDate,
    requested_count: count,
    input_count: input.length,
    eligible_count: eligible.length,
    selected_count: selected.length,
    rejected,
    hard_rules: {
      canonical_url_required: true,
      published_date_lte_as_of_date: true,
      evidence_required: true,
      excluded_topics_enforced: true,
      selected_difficulty_enforced: true,
      direct_urls_are_hard_scope: true,
      duplicate_source_url_rejected: true,
      duplicate_concept_rejected: true,
      source_family_diversity_preferred: true
    },
    ranking_signals: [
      'curator_base', 'topic_match', 'source_preference', 'difficulty_match',
      'content_style_match', 'novelty', 'feedback'
    ],
    selected: selected.map(candidate => ({
      lesson_key: candidate.lessonKey,
      title: candidate.title,
      url: candidate.url,
      source_family: sourceFamily(candidate),
      source_type: candidate.sourceType,
      published_at: candidate.date,
      difficulty: candidate.difficulty,
      score: candidate.score,
      score_breakdown: candidate.breakdown,
      source_weight: candidate.sourceWeight,
      feedback_matches: candidate.feedbackMatches
    }))
  };
}
