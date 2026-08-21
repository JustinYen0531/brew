import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sanitizePreferenceRecord } from '../api/preferences.mjs';
import { publicRecipe } from '../api/edition-recipe.mjs';
import { buildRecipeSnapshot } from './daily-brew.mjs';

const preferences = sanitizePreferenceRecord({
  recipe_id: 'ai-workflow',
  topics: ['Agent 與自動化'],
  topic_weights: { 'Agent 與自動化': 5 },
  output_language: 'en',
  blend_ratios: { new_discoveries: 50, saved_reviews: 25, classic: 15, surprise: 10 },
  timezone: 'America/Los_Angeles',
  morning_time: '06:30'
});

assert.equal(preferences.recipe_id, 'ai-workflow');
assert.equal(preferences.topic_weights['Agent 與自動化'], 5);
assert.equal(preferences.output_language, 'en');
assert.deepEqual(preferences.blend_ratios, { new_discoveries: 50, saved_reviews: 25, classic: 15, surprise: 10 });
assert.equal(preferences.timezone, 'America/Los_Angeles');
assert.equal(preferences.morning_time, '06:30');

const sourceCollection = {
  candidates: [{ title: '公開候選', url: 'https://github.com/example/project/issues/1', date: '2026-08-22', sourceType: 'GitHub', evidence: '可查證的摘要' }],
  snapshot: {
    version: 'source-collection-v1',
    as_of_date: '2026-08-22',
    requested_source_ids: ['github-community'],
    hard_direct_url_scope: false,
    custom_source_count: 0,
    candidate_count: 1,
    fallback_to_model_search: false,
    connectors: [{ source_id: 'github-community', status: 'ok', candidate_count: 1 }],
    policy: '只使用公開介面、RSS、使用者指定網址或合法授權。'
  }
};
const candidatePool = {
  version: 'candidate-pool-v1',
  as_of_date: '2026-08-22',
  requested_count: 1,
  input_count: 1,
  eligible_count: 1,
  selected_count: 1,
  rejected: {},
  hard_rules: { canonical_url_required: true, evidence_required: true },
  ranking_signals: ['curator_base', 'topic_match', 'feedback'],
  selected: [{ lesson_key: 'url:https://github.com/example/project/issues/1', title: '公開候選', url: 'https://github.com/example/project/issues/1', source_family: 'github', source_type: 'GitHub', published_at: '2026-08-22', difficulty: '普通', score: 7.2, score_breakdown: { topic_match: 2.1 }, source_weight: 5, feedback_matches: [], url_accessible: true }],
  source_collection: sourceCollection.snapshot,
  url_checks: [{ url: 'https://github.com/example/project/issues/1', accessible: true, status: 200 }]
};
const recipe = buildRecipeSnapshot('2026-08-22', sourceCollection);
recipe.preferences = { ...recipe.preferences, ...preferences };
const publicVersion = publicRecipe({ ...recipe, candidate_pool: candidatePool });

assert.equal(publicVersion.preferences.output_language, 'en');
assert.equal(publicVersion.preferences.topic_weights['Agent 與自動化'], 5);
assert.deepEqual(publicVersion.preferences.blend_ratios, preferences.blend_ratios);
assert.equal(publicVersion.source_collection.version, 'source-collection-v1');
assert.equal(publicVersion.candidate_pool.selected_count, 1);
assert.equal(publicVersion.candidate_pool.url_checks[0].status, 200);
assert.doesNotMatch(JSON.stringify(publicVersion), /OPENROUTER_API_KEY|OPENAI_API_KEY|SUPABASE_|service_role|sb_secret_/i);

const html = await readFile(new URL('../outputs/vibe-coding-daily-brew/index.html', import.meta.url), 'utf8');
for (const marker of [
  'id="second-pour-list"',
  'data-feedback-action="want_more"',
  'data-feedback-action="want_to_build"',
  'data-feedback-action="not_interested"',
  'data-feedback-action="exclude_source"',
  'id="topic-weight-list"',
  'name="preference-output-language"',
  'id="preference-blend-new"',
  'id="preference-morning-time"',
  '來源連接器紀錄',
  '候選池與網址檢查'
]) assert.match(html, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

const migration = await readFile(new URL('../supabase/migrations/20260822110000_add_morning_rhythm_preferences.sql', import.meta.url), 'utf8');
for (const column of ['topic_weights', 'output_language', 'blend_ratios', 'timezone', 'morning_time']) assert.match(migration, new RegExp(`add column if not exists ${column}`));

console.log('product contract: OK');
