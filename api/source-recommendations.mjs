import { discoverSources, rankSources, readSourceCatalog, sourceMatchesQuery, SOURCE_RANKING_VERSION } from '../source-catalog.mjs';

const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v4-flash-0731';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.4';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: '只接受 GET 請求。' });
  try {
    const query = String(req.query?.query || '').trim().slice(0, 160);
    const limit = Math.max(1, Math.min(10, Number(req.query?.limit) || 10));
    const catalog = await readSourceCatalog();
    const localSources = query.length >= 2 ? catalog.sources.filter(source => sourceMatchesQuery(source, query)) : [...catalog.sources];
    let sources = localSources;
    let live = false;
    const localMatches = localSources.length;
    if (query.length >= 2 && localMatches < 3) {
      const provider = req.query?.provider === 'openai' ? 'openai' : req.query?.provider === 'codex' ? 'codex' : 'openrouter';
      if (provider === 'codex') return res.status(200).json({ query, sources: rankSources(sources, query, limit), catalog_sources: catalog.sources, live: false, ranking_version: SOURCE_RANKING_VERSION, catalog_version: catalog.catalogVersion, updated_at: catalog.updatedAt });
      const apiKey = provider === 'openai' ? process.env.OPENAI_API_KEY?.trim() : process.env.OPENROUTER_API_KEY?.trim();
      const model = provider === 'openai' ? OPENAI_MODEL : OPENROUTER_MODEL;
      const discovered = await discoverSources(query, { apiKey, model, provider, limit: 5 });
      const knownUrls = new Set(sources.map(source => source.url.replace(/\/$/, '').toLowerCase()));
      for (const source of discovered) {
        const key = source.url.replace(/\/$/, '').toLowerCase();
        if (!knownUrls.has(key)) { sources.push(source); knownUrls.add(key); live = true; }
      }
    }
    return res.status(200).json({ query, sources: rankSources(sources, query, limit), catalog_sources: catalog.sources, live, ranking_version: SOURCE_RANKING_VERSION, catalog_version: catalog.catalogVersion, updated_at: catalog.updatedAt });
  } catch (error) {
    console.error(`Source recommendation failed: ${error.message}`);
    return res.status(500).json({ error: '來源推薦暫時無法使用。' });
  }
}
