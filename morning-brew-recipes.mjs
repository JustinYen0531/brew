export const MORNING_BREW_RECIPE_VERSION = 'morning-recipe-v1';

export const BREW_TONES = [
  {
    id: 'gentle-guide',
    name: '陪你入門',
    description: '少一點術語，多補背景與例子。',
    prompt: '請像一位耐心的入門老師，先補足必要背景，再用簡單語句解釋，不假設讀者已經熟悉專有名詞。'
  },
  {
    id: 'hands-on-editor',
    name: '實作導向',
    description: '先講能做什麼，再提供步驟與注意事項。',
    prompt: '請像一位做過這件事的實作編輯，先說清楚用途，再給可執行步驟、範例與容易踩到的限制。'
  },
  {
    id: 'curious-editor',
    name: '編輯精選',
    description: '保留事件脈絡、觀點與值得追問的地方。',
    prompt: '請像一位有判斷力的科技報紙編輯，保留來源脈絡、不同觀點與值得追問的限制，不只整理表面結論。'
  }
];

export const BREW_METHODS = [
  {
    id: 'concentrated-brief',
    name: '濃縮快報',
    description: '篇幅短，早晨先掌握最重要的幾件事。',
    prompt: '每篇先用一句話說清楚重點，再補最必要的例子與一個可以立刻嘗試的小動作。'
  },
  {
    id: 'daily-pour',
    name: '每日手沖',
    description: '摘要、例子與實作保持平衡。',
    prompt: '每篇保持摘要、具體例子、可轉移原則與練習問題的平衡，讓讀者讀完能理解也能動手。'
  },
  {
    id: 'slow-special',
    name: '慢萃專題',
    description: '篇數少一點，每篇留下更完整的脈絡。',
    prompt: '每篇多保留來源脈絡、取捨、反例與限制，寧可少講一點，也不要把重要的判斷壓成口號。'
  }
];

const SHARED_SOURCE_IDS = [
  'vibecoding-tw',
  'github-community',
  'hacker-news',
  'dev-community',
  'openai-community',
  'awesome-vibecoding',
  'reddit-vibecoding',
  'line-vibecoding-weekly',
  'roboco-manual',
  'indie-hackers'
];

export const MORNING_BREW_RECIPES = [
  {
    id: 'vibe-coding',
    name: 'Vibe Coding 入門',
    shortName: 'Vibe Coding',
    kicker: '一起把想法做出來',
    description: '用 AI 寫程式、和 Coding Agent 合作，逐步建立能重複使用的開發方法。',
    audience: '想開始做網站、工具或小型產品，也想慢慢理解開發流程的人。',
    topics: ['Vibe Coding', 'Coding Agent', '提示設計', '上下文管理', '測試與驗證', '除錯與工作流程'],
    excludedTopics: ['產品新聞', '模型發布摘要', '募資消息', '流行金句', '純功能清單'],
    sourceLanes: ['開發者討論', 'GitHub 實作', '技術文章', '建造者覆盤'],
    sourceFocus: '優先找真實 repository、issue、討論、失敗分析與可以重複的開發方法。',
    sourceIds: [...SHARED_SOURCE_IDS],
    defaultContentStyles: ['實戰案例', '失敗分析', '可重用規則']
  },
  {
    id: 'ai-creative',
    name: 'AI 創作工作室',
    shortName: 'AI 創作',
    kicker: '把靈感慢慢做成作品',
    description: '從圖像、動畫、影片、音樂到聲音，閱讀真正完成作品的創作流程。',
    audience: '想用 AI 做出視覺、影音或聲音作品，卻不想只追逐工具新聞的人。',
    topics: ['AI 圖像', '動畫與影片', 'AI 音樂', '聲音創作', '創作工作流', '作品案例'],
    excludedTopics: ['只有模型發布', '沒有作品的功能清單', '空泛的靈感金句'],
    sourceLanes: ['創作者社群', '作品案例', '工具實作', '開源模型與工作流'],
    sourceFocus: '優先找有成品、有過程、有失敗修正或能讓初學者照著嘗試的創作來源。',
    sourceIds: ['vibecoding-tw', 'awesome-vibecoding', 'dev-community', 'github-community', 'hacker-news', 'openai-community', 'line-vibecoding-weekly', 'roboco-manual', 'indie-hackers', 'reddit-vibecoding'],
    defaultContentStyles: ['作品案例', '步驟拆解', '工具比較']
  },
  {
    id: 'ai-workflow',
    name: 'AI 工作流與自動化',
    shortName: 'AI 工作流',
    kicker: '讓一天的工作少一點重複',
    description: '從 Agent、自動化、資料整理到研究流程，找出真的能省下時間的方法。',
    audience: '想把 AI 放進日常工作，並且在自動化之後仍保有檢查與掌控感的人。',
    topics: ['Agent 與自動化', '研究工作流', '文件處理', '資料整理', '個人效率', '團隊協作'],
    excludedTopics: ['只談效率口號', '沒有驗證方式的自動化', '純產品宣傳'],
    sourceLanes: ['工程社群', '工作流案例', '開發者論壇', '建造者覆盤'],
    sourceFocus: '優先找有輸入、步驟、檢查點與失敗處理的工作流，而不是只列工具名稱。',
    sourceIds: ['github-community', 'hacker-news', 'dev-community', 'openai-community', 'indie-hackers', 'vibecoding-tw', 'roboco-manual', 'awesome-vibecoding', 'reddit-vibecoding', 'line-vibecoding-weekly'],
    defaultContentStyles: ['工作流拆解', '失敗分析', '可重用規則']
  },
  {
    id: 'ai-product-design',
    name: 'AI 產品與設計',
    shortName: 'AI 產品',
    kicker: '從一個念頭走到有人使用',
    description: '閱讀 AI 產品的構想、原型、介面、回饋與發布過程。',
    audience: '想把 AI 點子做成產品，或想更懂設計與使用者判斷的人。',
    topics: ['產品構想', '原型與介面', '使用者體驗', 'AI 功能設計', '回饋與迭代', '發布與展示'],
    excludedTopics: ['只有融資新聞', '沒有使用者脈絡的案例', '漂亮但無法驗證的展示'],
    sourceLanes: ['建造者社群', '產品覆盤', '設計實作', '開發者討論'],
    sourceFocus: '優先找有使用者問題、取捨、回饋與迭代證據的產品故事。',
    sourceIds: ['indie-hackers', 'hacker-news', 'vibecoding-tw', 'github-community', 'dev-community', 'openai-community', 'awesome-vibecoding', 'roboco-manual', 'reddit-vibecoding', 'line-vibecoding-weekly'],
    defaultContentStyles: ['產品案例', '設計拆解', '反直覺觀點']
  },
  {
    id: 'ai-foundations',
    name: 'AI 工具與基礎素養',
    shortName: 'AI 基礎',
    kicker: '先把工具用得安心',
    description: '理解模型與工具的差異、Prompt 基礎、成本、隱私與可靠性。',
    audience: '剛進入 AI 世界，想建立判斷力而不是每天追新名詞的人。',
    topics: ['工具選擇', '模型差異', 'Prompt 基礎', '成本與限制', '隱私與安全', '可靠性判斷'],
    excludedTopics: ['只看排行榜', '沒有背景的模型新聞', '把猜測當成事實'],
    sourceLanes: ['官方開發者社群', '技術文章', '公開工程討論', '實作手冊'],
    sourceFocus: '優先找官方文件、實際測試、工程討論與能幫助初學者做出判斷的來源。',
    sourceIds: ['openai-community', 'github-community', 'hacker-news', 'dev-community', 'vibecoding-tw', 'roboco-manual', 'awesome-vibecoding', 'indie-hackers', 'reddit-vibecoding', 'line-vibecoding-weekly'],
    defaultContentStyles: ['入門解釋', '工具比較', '可重用規則']
  }
];

export function getMorningRecipe(id = 'vibe-coding') {
  return MORNING_BREW_RECIPES.find(recipe => recipe.id === id) || MORNING_BREW_RECIPES[0];
}

export function getBrewTone(id = 'hands-on-editor') {
  return BREW_TONES.find(tone => tone.id === id) || BREW_TONES[1];
}

export function getBrewMethod(id = 'daily-pour') {
  return BREW_METHODS.find(method => method.id === id) || BREW_METHODS[1];
}

export function publicMorningBrewCatalog() {
  return { version: MORNING_BREW_RECIPE_VERSION, recipes: MORNING_BREW_RECIPES, tones: BREW_TONES, methods: BREW_METHODS };
}

export function buildMorningBrewPrompt(count, preferences = {}, asOfDate) {
  const recipe = getMorningRecipe(preferences.recipeId || preferences.recipe_id);
  const tone = getBrewTone(preferences.editorialTone || preferences.editorial_tone);
  const method = getBrewMethod(preferences.brewMethod || preferences.brew_method);
  const sourceLanguage = (preferences.sourceLanguage || preferences.source_language) === 'en' ? 'English' : '繁體中文';
  const outputLanguage = (preferences.outputLanguage || preferences.output_language) === 'en' ? 'English' : '繁體中文';
  const topics = Array.isArray(preferences.topics) && preferences.topics.length ? preferences.topics.join('、') : recipe.topics.join('、');
  const excludedTopics = Array.isArray(preferences.excludedTopics) && preferences.excludedTopics.length ? preferences.excludedTopics.join('、') : recipe.excludedTopics.join('、');
  const contentStyles = Array.isArray(preferences.contentStyles) && preferences.contentStyles.length ? preferences.contentStyles.join('、') : recipe.defaultContentStyles.join('、');
  const sourceLanes = Array.isArray(preferences.sourceLanes) && preferences.sourceLanes.length ? preferences.sourceLanes.join('、') : recipe.sourceLanes.join('、');
  const difficultyLevels = Array.isArray(preferences.difficultyLevels) && preferences.difficultyLevels.length ? preferences.difficultyLevels.join('、') : '普通';
  const weightedSources = Object.entries(preferences.sourceWeights || {}).map(([source, weight]) => `${source}=${weight}/5`).join('、') || '尚未調整來源權重';
  const weightedTopics = Object.entries(preferences.topicWeights || preferences.topic_weights || {}).map(([topic, weight]) => `${topic}=${weight}/5`).join('、') || '尚未調整主題權重';
  const blend = preferences.blendRatios || preferences.blend_ratios || { new_discoveries: 60, saved_reviews: 20, classic: 10, surprise: 10 };
  const blendText = `新發現 ${Number(blend.new_discoveries ?? 60)}%／收藏複習 ${Number(blend.saved_reviews ?? 20)}%／經典 ${Number(blend.classic ?? 10)}%／意外驚喜 ${Number(blend.surprise ?? 10)}%`;
  const timezone = preferences.timezone || 'Asia/Taipei';
  const morningTime = preferences.morningTime || preferences.morning_time || '07:00';
  const collectedCandidates = Array.isArray(preferences.sourceCandidates) ? preferences.sourceCandidates.slice(0, 40) : [];
  const candidateBrief = collectedCandidates.length
    ? collectedCandidates.map((candidate, index) => `${index + 1}. ${candidate.title || '未命名'}｜${candidate.sourceType || candidate.source || '來源'}｜${candidate.date || '日期未知'}｜${candidate.url || ''}｜證據摘要：${candidate.evidence || '未提供'}`).join('\n')
    : '這次沒有收集到公開候選；可以使用模型搜尋，但仍必須逐篇驗證 canonical URL、日期與證據。';
  const selectedSources = [...(preferences.selectedSources || []), ...(preferences.customSources || [])]
    .filter(source => source?.url)
    .map(source => `${source.name || source.platform || '未命名來源'} <${source.url}>`)
    .join('；') || `使用「${recipe.name}」的預設來源包：${recipe.sourceIds.join('、')}`;
  const specificSources = Object.entries(preferences.specificSources || {}).filter(([, value]) => value).map(([source, value]) => `${source}: ${value}`).join('；') || '沒有指定特定社群';
  const directSources = Array.isArray(preferences.directUrls) && preferences.directUrls.length ? preferences.directUrls.join('\n') : '沒有硬性網址限制';
  const extraPrompt = preferences.prompt || preferences.sourcePrompt || preferences.source_prompt || '沒有額外採編備註';
  const feedbackSignals = Array.isArray(preferences.feedbackSignals) ? preferences.feedbackSignals.slice(0, 40).map(signal => {
    const snapshot = signal?.payload?.source_snapshot || {};
    const label = snapshot.title || signal?.lesson_key || '未命名內容';
    const context = [snapshot.sourceType, snapshot.category, snapshot.difficulty].filter(Boolean).join(' · ');
    return `${signal?.action || 'feedback'}：${label}${context ? `（${context}）` : ''}`;
  }).join('；') : '';
  return [
    `資料截點是 ${asOfDate}，資料截點也是 ${asOfDate}。這一壺晨報本次實際必須產出 ${count} 篇，不能多也不能少。請使用可用的 web search，找出在 ${asOfDate} 當天或之前已經存在的、與「${recipe.name}」相關、具體且可重複的實作方法，並整理成${outputLanguage}學習內容。嚴格禁止使用 ${asOfDate} 之後發布、更新或發生的發現，所有 source.published_at 必須小於或等於 ${asOfDate}。`,
    '',
    '【這一壺的主配方】',
    `主題：${recipe.name}`,
    `主題說明：${recipe.description}`,
    `適合讀者：${recipe.audience}`,
    `內容範圍：${recipe.topics.join('、')}`,
    `來源方向：${recipe.sourceFocus}`,
    '',
    '【編輯的沖煮方式】',
    `語氣：${tone.name}。${tone.prompt}`,
    `編排：${method.name}。${method.prompt}`,
    '',
    '【使用者的晨報配方】',
    `想讀的方向：${topics}`,
    `暫時避開：${excludedTopics}`,
    `偏好的內容形式：${contentStyles}`,
    `偏好的來源路徑：${sourceLanes}`,
    `難度：${difficultyLevels}`,
    `閱讀時間：${preferences.readingMinutes || preferences.reading_minutes || 10} 分鐘；希望篇數：${preferences.itemCount || preferences.item_count || count} 篇；新鮮度：${preferences.noveltyLevel || preferences.novelty_level || 3}/5；複習：${preferences.reviewEnabled === false || preferences.review_enabled === false ? '關閉' : '開啟'}`,
    `主題權重：${weightedTopics}`,
    `晨報比例：${blendText}；實際篇數請依比例取整，但必須剛好產出 ${count} 篇。`,
    `來源語言偏好：${sourceLanguage}`,
    `輸出語言：${outputLanguage}`,
    `偏好早晨：${timezone} ${morningTime}`,
    `來源權重：${weightedSources}`,
    `來源資料庫中已選取的提供者：${selectedSources}`,
    `特定社群偏好：${specificSources}`,
    `額外採編備註：${extraPrompt}`,
    `近期回饋訊號：${feedbackSignals || '目前還沒有可用的收藏回饋'}`,
    '使用回饋時，Super Starred 代表優先找相似的問題深度、內容形式或實作脈絡；Starred 代表值得保留；not_interested、unstarred 或 exclude_source 代表降低相似訊號。只把它當成排序與採編方向，仍要重新驗證每篇來源，不要重複同一篇內容。',
    '硬性網址來源（若有，只能從這些網址或其頁面翻找）：',
    directSources,
    '',
    '【來源連接器先收集的候選內容】',
    candidateBrief,
    collectedCandidates.length ? '候選內容已先經公開連接器收集；優先從這份清單提煉，不能捏造清單外的 URL。若需要補充，必須仍通過相同的日期、canonical URL 與來源證據檢查。' : '目前沒有連接器候選；這是 fallback 狀態，不代表可以省略來源驗證。',
    '',
    '請把來源推薦與硬性網址分開理解：來源推薦是排序訊號；硬性網址是來源限制。每篇都要有可以開啟的 canonical URL、發布日期與來源證據，不要捏造作者、日期、互動數據或引文。不要做產品新聞、募資消息、空泛金句或只有功能清單的內容。每篇只教一個可轉移的 idea，並說明問題、原則、可操作範例、限制、練習題與編輯綜合。難度請依先備知識與實作風險判定：初學者＝具備基本閱讀與提問能力即可嘗試；普通＝需要基本程式碼、repository 或測試經驗；困難＝需要多步驟整合、架構／權限／部署判斷，或實際操作後才能安全掌握。',
    '',
    '請只回傳 JSON object，不要 Markdown，不要前言，格式必須是：',
    '{"items":[{"title":"...","category":"思考|提示設計|Agent 管理|上下文工程|程式碼理解|驗證|工作流程|工藝與心態|安全|協作|學習系統","tag":"新鮮實作|近期耐用|舊作高價值","difficulty":"初學者|普通|困難","takeaway":"...","problem":"...","principle":"...","try_it":"...","tradeoffs":"...","practice_prompt":"...","source_says":"...","editorial_synthesis":"...","source":{"url":"https://...","platform":"...","published_at":"YYYY-MM-DD","evidence_excerpt":"...","popularity_basis":"..."},"scores":{"timeless":1,"importance":1,"popularity":1}}]}',
    '評分必須是 1 到 5 的數字。來源 URL、日期與證據不確定時，請如實降低評分或排除，不要創造來源。'
  ].join('\n');
}

function redactRecipeText(value) {
  return String(value || '')
    .replace(/\bsk-(?:or-v1-|ant-|proj-)?[A-Za-z0-9_-]{12,}/gi, '[已移除 API Key]')
    .replace(/\bsb_secret_[A-Za-z0-9_-]{10,}/gi, '[已移除 Supabase Secret]')
    .replace(/\b(?:OPENROUTER|OPENAI|SUPABASE)_[A-Z0-9_]*(?:KEY|TOKEN|SECRET)\s*=\s*[^\s,;]+/gi, '[已移除環境變數]')
    .replace(/\bBearer\s+[A-Za-z0-9._-]{16,}/gi, 'Bearer [已移除]');
}

function recipeArray(preferences, camelName, snakeName, fallback = []) {
  const value = preferences?.[camelName] ?? preferences?.[snakeName];
  const source = Array.isArray(value) && value.length ? value.slice(0, 20) : [...fallback];
  return source.map(item => typeof item === 'string' ? redactRecipeText(item) : item);
}

function recipeObject(preferences, camelName, snakeName) {
  const value = preferences?.[camelName] ?? preferences?.[snakeName];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 40).flatMap(([key, entry]) => {
    if (/(api[_-]?key|token|secret|password|authorization|bearer)/i.test(key)) return [];
    return [[key.slice(0, 120), typeof entry === 'string' ? redactRecipeText(entry) : entry]];
  }));
}

export function buildMorningBrewRecipeSnapshot({
  date,
  itemCount,
  kind = 'daily',
  provider = 'openrouter',
  model = '',
  preferences = {},
  generationRunId = '',
  candidatePool = null
} = {}) {
  const recipe = getMorningRecipe(preferences.recipeId || preferences.recipe_id);
  const recipeId = recipe.id;
  const editorialTone = preferences.editorialTone || preferences.editorial_tone || 'hands-on-editor';
  const brewMethod = preferences.brewMethod || preferences.brew_method || 'daily-pour';
  const sourceLanguage = preferences.sourceLanguage || preferences.source_language || 'zh-Hant';
  const outputLanguage = preferences.outputLanguage || preferences.output_language || 'zh-Hant';
  const selectedSourceIds = recipeArray(preferences, 'selectedSourceIds', 'selected_source_ids', recipe.sourceIds);
  const directUrls = recipeArray(preferences, 'directUrls', 'direct_urls').map(redactRecipeText);
  const sourcePrompt = redactRecipeText(preferences.sourcePrompt || preferences.source_prompt || preferences.prompt || '');
  const itemCountValue = Number(itemCount || preferences.itemCount || preferences.item_count || 10);
  const asOfDate = date || '';
  const recipePreferences = {
    recipe_id: recipeId,
    editorial_tone: editorialTone,
    brew_method: brewMethod,
    source_language: sourceLanguage,
    output_language: outputLanguage,
    selected_source_ids: selectedSourceIds,
    source_weights: recipeObject(preferences, 'sourceWeights', 'source_weights'),
    specific_sources: recipeObject(preferences, 'specificSources', 'specific_sources'),
    direct_urls: directUrls,
    source_prompt: sourcePrompt,
    feedback_signals: Array.isArray(preferences.feedbackSignals) ? preferences.feedbackSignals.slice(0, 40) : [],
    topics: recipeArray(preferences, 'topics', 'topics', recipe.topics),
    excluded_topics: recipeArray(preferences, 'excludedTopics', 'excluded_topics', recipe.excludedTopics),
    content_styles: recipeArray(preferences, 'contentStyles', 'content_styles', recipe.defaultContentStyles),
    source_lanes: recipeArray(preferences, 'sourceLanes', 'source_lanes', recipe.sourceLanes),
    difficulty_levels: recipeArray(preferences, 'difficultyLevels', 'difficulty_levels', ['普通']),
    topic_weights: recipeObject(preferences, 'topicWeights', 'topic_weights'),
    reading_minutes: Number(preferences.readingMinutes || preferences.reading_minutes || 10),
    item_count: itemCountValue,
    novelty_level: Number(preferences.noveltyLevel || preferences.novelty_level || 3),
    review_enabled: preferences.reviewEnabled !== false && preferences.review_enabled !== false,
    blend: preferences.blendRatios || preferences.blend_ratios || { new_discoveries: 60, saved_reviews: 20, classic: 10, surprise: 10 },
    timezone: String(preferences.timezone || 'Asia/Taipei').slice(0, 64),
    morning_time: String(preferences.morningTime || preferences.morning_time || '07:00').slice(0, 5)
  };
  const safePreferences = JSON.parse(redactRecipeText(JSON.stringify(recipePreferences)));
  return {
    schema_version: 'personal-recipe-v1',
    kind: kind === 'daily' ? 'personal_daily_brew' : kind === 'manual' ? 'personal_manual_brew' : 'personal_historical_brew',
    run_date: asOfDate,
    as_of_date: asOfDate,
    preferences: safePreferences,
    prompt: {
      version: `${MORNING_BREW_RECIPE_VERSION}-prompt`,
      system: '你是 Vibe Coding Daily Brew 的嚴謹中文編輯。只保留有證據、可轉移、可實作的做法。',
      text: redactRecipeText(buildMorningBrewPrompt(itemCountValue, preferences, asOfDate))
    },
    model: {
      provider: String(provider || '').slice(0, 80),
      name: String(model || '').slice(0, 160),
      generation_method: provider === 'codex' ? 'local_codex_exec' : 'provider_api'
    },
    generation_run_id: String(generationRunId || '').slice(0, 160),
    search_rules: {
      version: 'personal-search-v1',
      web_search_required: true,
      allowed_source_date_lte: asOfDate,
      canonical_url_required: true,
      evidence_required: true
    },
    candidate_pool: candidatePool ? JSON.parse(redactRecipeText(JSON.stringify(candidatePool))) : null
  };
}
