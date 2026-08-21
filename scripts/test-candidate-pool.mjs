import assert from 'node:assert/strict';
import { filterAndRankCandidates } from '../candidate-pool.mjs';

function item(overrides = {}) {
  return {
    title: '用小步驟讓 coding agent 更容易驗證',
    category: 'Agent 管理',
    difficulty: '初學者',
    takeaway: '把任務切成可以檢查的小步驟。',
    problem: '一次交付太大的任務很難知道錯在哪裡。',
    principle: '每一步都留下可驗證的結果。',
    tryIt: '先要求 agent 只完成一個小改動，再跑測試。',
    tradeoffs: '步驟變多，但回溯成本下降。',
    evidence: '來源討論具體描述了小步驟與測試的做法。',
    importance: 4,
    timeless: 4,
    heat: 3,
    source: 'GitHub · 即時來源',
    sourceType: 'GitHub',
    date: '2026-08-20',
    url: 'https://github.com/example/project/discussions/1',
    ...overrides
  };
}

const preferences = {
  topics: ['Vibe Coding'],
  excludedTopics: ['政治'],
  difficultyLevels: ['初學者', '普通'],
  sourceWeights: { github: 5, reddit: 1 },
  noveltyLevel: 4,
  feedbackSignals: [{
    action: 'super_starred',
    payload: { source_snapshot: { url: 'https://github.com/example/old/discussions/9', sourceType: 'GitHub', category: 'Agent 管理', difficulty: '初學者', principle: '讓 coding agent 每一步都可以驗證。' } }
  }]
};

const result = filterAndRankCandidates([
  item(),
  item({ title: '把 agent 工作切成可驗證的小任務', principle: '先建立小型檢查點，再逐段擴大任務範圍。', url: 'https://github.com/example/project/issues/2' }),
  item({ title: 'Reddit 的初學者 agent 失敗覆盤', principle: '失敗後先保留重現步驟與上下文，再調整提示。', source: 'Reddit · 即時來源', sourceType: 'Reddit', url: 'https://www.reddit.com/r/vibecoding/comments/abc/practice/' }),
  item({ title: 'DEV 的測試先行工作流', principle: '先寫一個最小測試，讓每次生成都有明確的完成條件。', source: 'DEV.to · 即時來源', sourceType: 'DEV.to', url: 'https://dev.to/example/test-first-agent-1' }),
  item({ title: '未來的內容', url: 'https://dev.to/example/future', date: '2026-08-23' }),
  item({ title: '政治新聞', url: 'https://dev.to/example/politics', category: '政治' }),
  item({ title: '沒有來源證據', url: 'https://dev.to/example/no-evidence', evidence: 'unknown' })
], preferences, '2026-08-22', { count: 3 });

assert.equal(result.items.length, 3);
assert.equal(result.snapshot.version, 'candidate-pool-v1');
assert.equal(result.snapshot.selected_count, 3);
assert.equal(result.snapshot.rejected.published_after_cutoff, 1);
assert.equal(result.snapshot.rejected.excluded_topic, 1);
assert.equal(result.snapshot.rejected.required_evidence_missing, 1);
assert.equal(result.snapshot.hard_rules.direct_urls_are_hard_scope, true);
assert.equal(result.snapshot.selected[0].source_family, 'github');
assert.equal(result.snapshot.hard_rules.source_family_diversity_preferred, true);

const scoped = filterAndRankCandidates([
  item({ url: 'https://github.com/example/project/discussions/3' }),
  item({ url: 'https://dev.to/example/outside' })
], { ...preferences, directUrls: ['https://github.com/example/project/'] }, '2026-08-22', { count: 1 });
assert.equal(scoped.items[0].url, 'https://github.com/example/project/discussions/3');
assert.equal(scoped.snapshot.rejected.outside_hard_url_scope, 1);

assert.throws(() => filterAndRankCandidates([item()], preferences, '2026-08-22', { count: 2 }), error => error.message === 'candidate_pool_insufficient' && error.candidatePool?.selected_count === 1);

console.log('candidate pool contract: OK');
