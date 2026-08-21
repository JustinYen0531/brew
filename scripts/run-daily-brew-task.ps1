$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runDate = Get-Date -Format 'yyyy-MM-dd'
$generationRunsOutput = Join-Path $projectRoot 'outputs\vibe-coding-daily-brew\daily\generation-runs'

Push-Location $projectRoot
try {
  & node (Join-Path $PSScriptRoot 'daily-brew.mjs') '--date' $runDate '--quiet'
  if ($LASTEXITCODE -ne 0) { throw "daily-brew failed with exit code $LASTEXITCODE" }

  $datedOutput = Join-Path $projectRoot "outputs\vibe-coding-daily-brew\daily\$runDate.json"
  $latestOutput = Join-Path $projectRoot 'outputs\vibe-coding-daily-brew\daily\latest.json'
  if (-not (Test-Path -LiteralPath $datedOutput) -or -not (Test-Path -LiteralPath $latestOutput)) {
    throw 'daily-brew did not produce both dated and latest outputs'
  }

  git add -- $datedOutput $latestOutput $generationRunsOutput
  git diff --cached --quiet -- $datedOutput $latestOutput $generationRunsOutput
  if ($LASTEXITCODE -eq 0) { exit 0 }

  $branch = (git branch --show-current).Trim()
  if (-not $branch) { throw 'cannot determine current git branch' }
  git commit -m "chore: publish Vibe Coding daily brew $runDate"
  if ($LASTEXITCODE -ne 0) { throw 'git commit failed' }
  git push origin $branch
  if ($LASTEXITCODE -ne 0) { throw 'git push failed' }
}
catch {
  if (Test-Path -LiteralPath $generationRunsOutput) {
    git add -- $generationRunsOutput
    git diff --cached --quiet -- $generationRunsOutput
    if ($LASTEXITCODE -ne 0) {
      $branch = (git branch --show-current).Trim()
      if (-not $branch) { throw 'cannot determine current branch while recording failed generation' }
      git commit -m "chore: record failed daily brew generation $runDate"
      if ($LASTEXITCODE -ne 0) { throw 'failed generation log commit failed' }
      git push origin $branch
      if ($LASTEXITCODE -ne 0) { throw 'failed generation log push failed' }
    }
  }
  throw
}
finally {
  Pop-Location
}
