# Vibe Coding Daily Brew

這個專案提供一個繁體中文的 Vibe Coding 每日學習頁，並依照 `vibe-coding-curator` skill 的證據、評分與 HTML 契約產生每天恰好 10 個發現。

## 本機測試

先確認 `.env.local` 已設定至少一個可用的生成方式，再執行：

```powershell
node scripts/daily-brew.mjs --dry-run --date 2026-08-20
node scripts/daily-brew.mjs
node server.mjs
```

生成方式可以在網站「我的配方 → 配方細節 → 生成方式」切換：

- `OpenRouter`：使用 `OPENROUTER_API_KEY`，保留目前既有流程。
- `OpenAI API`：使用 `OPENAI_API_KEY` 與 `OPENAI_MODEL`，透過 OpenAI Responses API 的 web search 生成；API 用量與 ChatGPT 訂閱額度分開計算。
- `本機 Codex（訂閱）`：只在本機 `node server.mjs` 有效。先在同一台電腦完成 `codex login` 並選擇 ChatGPT 登入，網站按鈕才會透過 `codex exec --ephemeral` 執行；Vercel 不會代跑你的本機 Codex。

建議先把 `.env.example` 複製成 `.env.local`，填入你要使用的 key；不要把任何 API key 放進 HTML、localStorage 或公開 repository。`BREW_PROVIDER` 只決定初始預設值，配方細節可以逐次切換。

## 不用信箱的晨報帳號

網站現在不要求使用者提交電子郵件。第一次按「我的晨報」時，只要輸入「晨報怎麼稱呼你？」的暱稱即可。系統會在 Supabase 建立一個匿名帳號 ID，暱稱只用來顯示成「某某的晨報」；配方真正依照匿名帳號 ID 分開保存。

第一次接線時，請在 Supabase Auth 開啟 `Allow anonymous sign-ins`，再依序套用：

```text
supabase/migrations/20260821134423_create_brew_preferences.sql
supabase/migrations/20260821160000_create_brew_profiles.sql
supabase/migrations/20260821190000_add_morning_brew_recipe_settings.sql
supabase/migrations/20260822100000_create_personal_brew_data.sql
supabase/migrations/20260822101000_add_personal_brew_fk_indexes.sql
supabase/migrations/20260822102000_allow_review_queue_cleanup.sql
supabase/migrations/20260822110000_add_morning_rhythm_preferences.sql
```

第一階段的登入後流程會先請使用者選一份固定主配方，再選編輯語氣與沖煮方式，最後設定閱讀難度、每天篇數、閱讀時間、新鮮感與是否帶回收藏複習。目前提供五份科技方向：Vibe Coding 入門、AI 創作工作室、AI 工作流與自動化、AI 產品與設計、AI 工具與基礎素養。主配方決定「想讀什麼」，來源櫃決定「材料從哪裡來」；來源櫃也能調整主題權重、輸出語言、晨報比例、時區與早晨時間。

每份晨報配方都會把 `recipe_id`、`editorial_tone`、`brew_method`、來源語言、來源選擇、來源權重、指定社群、硬性網址與額外採編備註分開保存。API payload 不包含 API key；API key 只留在目前瀏覽器的本機設定裡。

這個帳號是「目前瀏覽器裡的晨報身份」。清除瀏覽器資料、登出或換裝置後，單靠暱稱無法找回原本的配方；這是不用信箱換來的隱私邊界。

每日自動生成會把當次的配方、提示詞版本、模型、搜尋規則、來源連接器、候選池、URL 檢查、嘗試紀錄與輸出來源保存進 `daily/generation-runs/`，同時把配方副本嵌入當天的 edition。可以用 `/api/edition-recipe?date=YYYY-MM-DD` 讀取安全的公開版本；網站會在今日與過往日報顯示「查看本期配方」，提供公開配方與分享連結的複製操作。個人晨報則把同一份配方快照存入 Supabase 的個人 edition。

生成結果會放在 `outputs/vibe-coding-daily-brew/daily/YYYY-MM-DD.json`，網站會優先讀取 `daily/latest.json`；同一天已有檔案時，重跑會安全跳過。需要重新生成時才使用 `--force`。

「過往手沖」會以 `daily/YYYY-MM-DD.json` 判定某天是否已經生成過批次。選取沒有批次的日期後，按「生成一批」會固定手沖 10 份，並把該日期當成公示日期；來源日期不得晚於該日，也不會覆蓋 `latest.json`。本機 server 會把歷史批次保存到 `daily/`，可用 `/api/archive` 查詢日曆與指定日期內容。

本機測試歷史手沖：

```powershell
node server.mjs
# 接著用 PowerShell 檢查 API
Invoke-RestMethod http://localhost:4173/api/health
Invoke-RestMethod http://localhost:4173/api/recipe-catalog
Invoke-RestMethod 'http://localhost:4173/api/source-recommendations?recipe_id=ai-creative&limit=10'
```

來源探索資料庫位於 `data/vibe-coding-source-catalog.json`，目前有 10 個候選提供者；每份主配方會帶著自己的固定來源包。來源櫃開啟時會載入該主配方的 10 筆排序結果；輸入來源名稱、主題或社群後，先用資料庫別名與主題比對，符合項目不足 3 個時才嘗試即時搜尋。每日手沖前會由 `source-connectors.mjs` 收集公開 GitHub、Hacker News、Reddit RSS、DEV.to 與公開 RSS 候選，生成後再逐一確認 URL 是否可訪問。Facebook、LINE、ROBOCO 等沒有合法公開連接器的來源只會標示為 `unsupported`，需要官方 API、合法授權或手動匯入，不會假裝已經讀過。每日手沖本身則依你選取的 provider 使用對應 key。

主配方目錄可由 `/api/recipe-catalog` 取得，這讓前端的五份選擇與伺服器採用同一份資料。每一期自動日報會保存當時的主配方、語氣、沖煮方式、來源設定與完整 Prompt；歷史手沖也會在 edition 裡保留 `manual_brew` 配方快照。

來源推薦的排序與 endpoint 可單獨做靜態／命令列驗證，不需要瀏覽器：

```powershell
node --check source-catalog.mjs
node --check api/source-recommendations.mjs
node --input-type=module -e "import { readFile } from 'node:fs/promises'; const data = JSON.parse(await readFile('data/vibe-coding-source-catalog.json', 'utf8')); console.log(data.sources.length, data.defaultSourceIds.length)"
```

未登入時，配方細節中的「加入我的配方」與「新增來源」會先保存在目前瀏覽器的 `localStorage`；登入後，正式偏好會保存到 Supabase。API key 仍只留在目前瀏覽器的本機設定，不會寫入偏好、edition、生成履歷或公開配方；這些設定只是排序線索，不會降低每日內容的來源日期、作者、證據與可重複性要求。

Vercel 的 `/api/brew` 已能在帶有匿名 Supabase Access Token 時保存個人 daily、manual、historical edition；沒有登入的歷史模擬仍只回傳結果，不會寫入個人資料。要做跨瀏覽器、跨裝置找回匿名帳號，仍需要另設計使用者同意的正式登入方式。

來源連接器與候選池都遵守同一條規則：來源收集只使用公開介面、RSS、使用者指定網址或合法授權；模型不能把沒有證據的網址、作者、日期或互動數據補成「看起來完整」。候選不足時，手沖會失敗並留下失敗原因，不會塞入假文章。

## Windows 自動排程

以「系統管理員身分執行」的 PowerShell 執行一次：

```powershell
.\scripts\install-daily-brew-task.ps1
```

它會註冊兩個觸發點：互動登入時，以及每天本地時間 06:00。generator 以日期檔案去重，所以開機與 06:00 同時觸發不會重複呼叫 API。移除排程：

```powershell
.\scripts\install-daily-brew-task.ps1 -Unregister
```

Codex automation 另外負責每日 06:00 的主機側提醒/執行；排程本身不由 HTML 檔案冒充建立。
