import assert from 'node:assert/strict';
import { buildRecipeSnapshot, promptForAttempt } from './daily-brew.mjs';
import { publicRecipe } from '../api/edition-recipe.mjs';

const recipe = buildRecipeSnapshot('2026-08-21');
assert.equal(recipe.schema_version, 'daily-recipe-v1');
assert.equal(recipe.kind, 'automatic_daily_brew');
assert.equal(recipe.as_of_date, '2026-08-21');
assert.deepEqual(recipe.preferences.blend, { new_discoveries: 6, saved_reviews: 2, classic: 1, surprise: 1 });
assert.equal(recipe.preferences.item_count, 10);
assert.equal(recipe.prompt.version, 'daily-prompt-v1');
assert.match(recipe.prompt.text, /資料截點也是 2026-08-21/);
assert.match(promptForAttempt(recipe, 2), /第 2 次嘗試/);
assert.equal(recipe.search_rules.ranking_formula_version, 'v1');

const serialized = JSON.stringify(recipe);
assert.doesNotMatch(serialized, /OPENROUTER_API_KEY|OPENAI_API_KEY|SUPABASE_|service_role|sb_secret_/i);

const shared = publicRecipe(recipe);
assert.equal(shared.kind, 'automatic_daily_brew');
assert.equal(shared.prompt.text, recipe.prompt.text);
assert.equal('excluded_topics' in shared.preferences, false);
assert.equal(publicRecipe({ ...recipe, kind: 'manual_brew' }), null);

console.log('daily recipe contract: OK');
