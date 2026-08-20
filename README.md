# Vibe Coding Daily Brew

這個專案提供一個繁體中文的 Vibe Coding 每日學習頁，並依照 `vibe-coding-curator` skill 的證據、評分與 HTML 契約產生每天恰好 10 個發現。

## 本機測試

先確認 `.env.local` 已設定 `OPENROUTER_API_KEY`，再執行：

```powershell
node scripts/daily-brew.mjs --dry-run --date 2026-08-20
node scripts/daily-brew.mjs
node server.mjs
```

生成結果會放在 `outputs/vibe-coding-daily-brew/daily/YYYY-MM-DD.json`，網站會優先讀取 `daily/latest.json`；同一天已有檔案時，重跑會安全跳過。需要重新生成時才使用 `--force`。

「過往手沖」會以 `daily/YYYY-MM-DD.json` 判定某天是否已經生成過批次。選取沒有批次的日期後，按「生成一批」會固定手沖 10 份，並把該日期當成公示日期；來源日期不得晚於該日，也不會覆蓋 `latest.json`。本機 server 會把歷史批次保存到 `daily/`，可用 `/api/archive` 查詢日曆與指定日期內容。

本機測試歷史手沖：

```powershell
node server.mjs
# 接著用瀏覽器開啟 http://localhost:4173，進入「過往手沖」
```

來源探索資料庫位於 `data/vibe-coding-source-catalog.json`，目前有 10 個候選提供者，預設選取 5 個：`vibecoding.tw`、GitHub Community、Hacker News、DEV Community、OpenAI Developer Community。偏好區塊開啟時會載入 10 筆排序結果；輸入來源名稱、主題或社群後，先用資料庫別名與主題比對，符合項目不足 3 個時才嘗試即時搜尋。需要即時搜尋時，請讓 `.env.local` 有 `OPENROUTER_API_KEY`；沒有 key 仍可使用本地目錄與自訂 URL。

來源推薦的排序與 endpoint 可單獨做靜態／命令列驗證，不需要瀏覽器：

```powershell
node --check source-catalog.mjs
node --check api/source-recommendations.mjs
node --input-type=module -e "import { readFile } from 'node:fs/promises'; const data = JSON.parse(await readFile('data/vibe-coding-source-catalog.json', 'utf8')); console.log(data.sources.length, data.defaultSourceIds.length)"
```

偏好中的「加入我的偏好」與「新增來源」會保存在目前瀏覽器的 `localStorage`；它們是排序偏好，不會降低每日內容的來源日期、作者、證據與可重複性要求。

Vercel 的 `/api/brew` 可以回傳歷史模擬批次，但目前沒有接資料庫；前端會將本次生成保存在目前瀏覽器的 localStorage。要做跨瀏覽器、跨裝置的永久歷史庫，仍需要另接持久化儲存。

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
