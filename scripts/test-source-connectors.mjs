import assert from 'node:assert/strict';
import { collectSourceCandidates } from '../source-connectors.mjs';

const feed = `<?xml version="1.0"?><rss><channel><item><title><![CDATA[先把 Agent 任務切小]]></title><link>https://www.reddit.com/r/vibecoding/comments/abc/small_steps/</link><pubDate>Thu, 21 Aug 2026 08:00:00 GMT</pubDate><description><![CDATA[每一段都留下可檢查的結果。]]></description></item></channel></rss>`;
const fetchImpl = async url => {
  const value = String(url);
  if (value.includes('hn.algolia.com')) return { ok: true, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ hits: [{ title: 'Small agent loops', url: 'https://news.ycombinator.com/item?id=123', created_at: '2026-08-20T08:00:00Z', story_text: 'A practical workflow with checkpoints.' }] }) };
  if (value.includes('reddit.com')) return { ok: true, headers: { get: () => 'application/rss+xml' }, text: async () => feed };
  if (value.includes('example.com')) return { ok: true, headers: { get: () => 'application/rss+xml' }, text: async () => feed };
  return { ok: false, status: 404, headers: { get: () => '' }, text: async () => '' };
};

const result = await collectSourceCandidates({ selectedSourceIds: ['hacker-news', 'reddit-vibecoding', 'facebook'], topics: ['Vibe Coding'] }, '2026-08-22', { fetchImpl });
assert.equal(result.snapshot.version, 'source-collection-v1');
assert.equal(result.candidates.length, 2);
assert.equal(result.snapshot.connectors.find(item => item.source_id === 'facebook').status, 'unsupported');
assert.equal(result.snapshot.fallback_to_model_search, false);

const direct = await collectSourceCandidates({ directUrls: ['https://example.com/feed.xml'], topics: ['Vibe Coding'] }, '2026-08-22', { fetchImpl });
assert.equal(direct.snapshot.hard_direct_url_scope, true);
assert.equal(direct.snapshot.requested_source_ids[0], 'direct:https://example.com/feed.xml');
assert.equal(direct.candidates.length, 1);

console.log('source connector contract: OK');
