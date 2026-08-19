param(
  [switch]$Unregister
)

$ErrorActionPreference = 'Stop'
$taskName = 'Vibe Coding Daily Brew'
$projectRoot = Split-Path -Parent $PSScriptRoot

if ($Unregister) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output "Unregistered: $taskName"
  exit 0
}

$nodeCommand = Get-Command node -ErrorAction Stop
$powershellCommand = Get-Command powershell -ErrorAction Stop
$wrapperPath = Join-Path $PSScriptRoot 'run-daily-brew-task.ps1'
$arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $wrapperPath + '"'
$action = New-ScheduledTaskAction -Execute $powershellCommand.Source -Argument $arguments -WorkingDirectory $projectRoot
$dailyTrigger = New-ScheduledTaskTrigger -Daily -At '06:00'
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType InteractiveToken -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($dailyTrigger, $logonTrigger) -Settings $settings -Principal $principal -Description 'Generate exactly 10 evidence-backed Vibe Coding discoveries once per local day.' -Force -ErrorAction Stop | Out-Null
Write-Output "Registered: $taskName"
Write-Output "Triggers: daily 06:00 and interactive logon"
Write-Output "Project: $projectRoot"
