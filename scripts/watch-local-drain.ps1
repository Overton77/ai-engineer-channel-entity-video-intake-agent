param(
  [int]$AdoptPid = 0,
  [string]$AdoptStdout = "",
  [int]$RestartDelaySeconds = 15,
  [int]$PollSeconds = 15,
  [int]$StallTimeoutSeconds = 2400
)

$ErrorActionPreference = "Stop"
$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$logDirectory = Join-Path $workspace "outputs\local-drain"
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$watchdogLog = Join-Path $logDirectory "watchdog.log"
$nodePath = (Get-Command node -ErrorAction Stop).Source
$env:PRE_RESEARCH_STAGE_LEASE_SECONDS = "1800"

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class PreResearchKeepAwake {
  [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  public static extern uint SetThreadExecutionState(uint flags);
}
"@

$ES_CONTINUOUS = [uint32]2147483648
$ES_SYSTEM_REQUIRED = [uint32]0x00000001
[void][PreResearchKeepAwake]::SetThreadExecutionState($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED)

function Write-WatchdogEvent([string]$EventName, [hashtable]$Fields = @{}) {
  $payload = @{ event = $EventName; at = (Get-Date).ToUniversalTime().ToString("o") } + $Fields
  Add-Content -LiteralPath $watchdogLog -Value ($payload | ConvertTo-Json -Compress)
}

function Wait-DrainWorker([System.Diagnostics.Process]$Worker, [string]$StdoutPath) {
  while (-not $Worker.HasExited) {
    $progressAt = $Worker.StartTime
    if ($StdoutPath -and (Test-Path -LiteralPath $StdoutPath)) {
      $progressAt = (Get-Item -LiteralPath $StdoutPath).LastWriteTime
    }
    $quietSeconds = [int]((Get-Date) - $progressAt).TotalSeconds
    if ($quietSeconds -ge $StallTimeoutSeconds) {
      Write-WatchdogEvent "worker_stalled" @{
        pid = $Worker.Id
        stdout = $StdoutPath
        quiet_seconds = $quietSeconds
        stall_timeout_seconds = $StallTimeoutSeconds
      }
      Stop-Process -Id $Worker.Id -Force -ErrorAction SilentlyContinue
      $Worker.WaitForExit()
      return
    }
    Start-Sleep -Seconds $PollSeconds
    $Worker.Refresh()
  }
  $Worker.WaitForExit()
}

try {
  if ($AdoptPid -gt 0) {
    $adoptedWorker = Get-Process -Id $AdoptPid -ErrorAction SilentlyContinue
    if ($adoptedWorker) {
      $adoptedStdoutPath = $AdoptStdout
      if (-not $adoptedStdoutPath) {
        $adoptedStdoutPath = (Get-ChildItem -LiteralPath $logDirectory -Filter "drain-*.stdout.log" |
          Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
      }
      Write-WatchdogEvent "adopting_existing_worker" @{ pid = $AdoptPid; stdout = $adoptedStdoutPath }
      Wait-DrainWorker $adoptedWorker $adoptedStdoutPath
      Write-WatchdogEvent "adopted_worker_exited" @{ pid = $AdoptPid; exit_code = $adoptedWorker.ExitCode }
    }
  }

  while ($true) {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $stdout = Join-Path $logDirectory "drain-$stamp.stdout.log"
    $stderr = Join-Path $logDirectory "drain-$stamp.stderr.log"
    $arguments = @(
      "--experimental-strip-types",
      "--import",
      "./scripts/register-ts.mjs",
      "scripts/run-all-pre-research-pipelines.mjs",
      "--max-transient-retries",
      "0"
    )
    $worker = Start-Process -FilePath $nodePath -ArgumentList $arguments -WorkingDirectory $workspace `
      -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru
    Write-WatchdogEvent "worker_started" @{ pid = $worker.Id; stdout = $stdout; stderr = $stderr }
    Wait-DrainWorker $worker $stdout
    Write-WatchdogEvent "worker_exited" @{ pid = $worker.Id; exit_code = $worker.ExitCode }
    if ($worker.ExitCode -eq 0) {
      break
    }
    Start-Sleep -Seconds $RestartDelaySeconds
  }
} finally {
  [void][PreResearchKeepAwake]::SetThreadExecutionState($ES_CONTINUOUS)
  Write-WatchdogEvent "watchdog_exited"
}
