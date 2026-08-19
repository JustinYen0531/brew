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

## Windows 自動排程

以目前使用者在 PowerShell 執行一次：

```powershell
.\scripts\install-daily-brew-task.ps1
```

它會註冊兩個觸發點：互動登入時，以及每天本地時間 06:00。generator 以日期檔案去重，所以開機與 06:00 同時觸發不會重複呼叫 API。移除排程：

```powershell
.\scripts\install-daily-brew-task.ps1 -Unregister
```

Codex automation 另外負責每日 06:00 的主機側提醒/執行；排程本身不由 HTML 檔案冒充建立。
