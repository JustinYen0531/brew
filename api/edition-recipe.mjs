import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DAILY_DIR = path.join(ROOT, '..', 'outputs', 'vibe-coding-daily-brew', 'daily');

function send(res, status, body, cacheControl = 'private,no-store') {
  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(status).json(body);
}

async function readEdition(date) {
  return JSON.parse(await readFile(path.join(DAILY_DIR, `${date}.json`), 'utf8'));
}

function redactPublicText(value) {
  return String(value || '')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, '[已移除 API Key]')
    .replace(/\bsb_secret_[A-Za-z0-9_-]{10,}/g, '[已移除 Supabase Secret]')
    .replace(/\bBearer\s+[A-Za-z0-9._-]{16,}/gi, 'Bearer [已移除]');
}

export function publicRecipe(recipe) {
  if (!recipe || recipe.kind !== 'automatic_daily_brew') return null;
  return {
    schema_version: recipe.schema_version,
    kind: recipe.kind,
    run_date: recipe.run_date,
    as_of_date: recipe.as_of_date,
    preferences: {
      recipe_id: recipe.preferences?.recipe_id || 'vibe-coding',
      editorial_tone: recipe.preferences?.editorial_tone || 'hands-on-editor',
      brew_method: recipe.preferences?.brew_method || 'daily-pour',
      source_language: recipe.preferences?.source_language || recipe.preferences?.language || 'zh-Hant',
      selected_source_ids: recipe.preferences?.selected_source_ids || [],
      source_weights: recipe.preferences?.source_weights || {},
      topics: recipe.preferences?.topics || [],
      source_lanes: recipe.preferences?.source_lanes || [],
      difficulty_levels: recipe.preferences?.difficulty_levels || [],
      language: recipe.preferences?.language || 'zh-Hant',
      item_count: recipe.preferences?.item_count || 10,
      novelty_level: recipe.preferences?.novelty_level || 3,
      review_enabled: recipe.preferences?.review_enabled !== false,
      blend: recipe.preferences?.blend || null
    },
    prompt: {
      version: recipe.prompt?.version || '',
      system: redactPublicText(recipe.prompt?.system),
      text: redactPublicText(recipe.prompt?.text)
    },
    model: recipe.model || {},
    search_rules: recipe.search_rules || {}
  };
}

export function buildEditionRecipeResponse(edition) {
  if (!edition || edition.mode !== 'daily' || !edition.generation_recipe) return null;
  const recipe = publicRecipe(edition.generation_recipe);
  if (!recipe) return null;
  return {
    edition: {
      id: edition.id || '',
      run_date: edition.run_date,
      as_of_date: edition.as_of_date || edition.run_date,
      generated_at: edition.generated_at,
      generation_run_id: edition.generation_run_id,
      item_count: Array.isArray(edition.items) ? edition.items.length : 0,
      sources: (edition.items || []).map(item => ({ title: item.title, url: item.url, platform: item.sourceType || '' }))
    },
    generation: {
      id: edition.generation_run?.id || edition.generation_run_id || '',
      status: edition.generation_run?.status || 'complete',
      started_at: edition.generation_run?.started_at || '',
      completed_at: edition.generation_run?.completed_at || edition.generated_at || '',
      attempts: (edition.generation_run?.attempts || []).map(attempt => ({
        number: attempt.number,
        started_at: attempt.started_at,
        system: redactPublicText(attempt.system),
        user: redactPublicText(attempt.user),
        provider: attempt.provider,
        model: attempt.model
      }))
    },
    recipe,
    share: {
      copy_text: '我用這套日報配方與提示詞，生成出了一份高品質的每日報紙。',
      api_path: `/api/edition-recipe?date=${encodeURIComponent(edition.run_date)}`
    }
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: '只接受 GET 請求。' });
  const date = typeof req.query?.date === 'string' ? req.query.date : '';
  if (date !== 'latest' && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return send(res, 400, { error: '日期格式必須是 YYYY-MM-DD。' });
  try {
    const edition = await readEdition(date);
    const payload = buildEditionRecipeResponse(edition);
    if (!payload) return send(res, 404, { error: '這一期沒有保存可公開的自動日報配方。' });
    const immutable = date !== 'latest';
    return send(res, 200, payload, immutable ? 'public,max-age=0,s-maxage=31536000,immutable' : 'public,max-age=0,s-maxage=60');
  } catch (error) {
    if (error.code === 'ENOENT') return send(res, 404, { error: '找不到這一天的日報配方。' });
    console.error(`Edition recipe failed: ${error.message}`);
    return send(res, 500, { error: '目前讀不到這一期的日報配方。' });
  }
}
