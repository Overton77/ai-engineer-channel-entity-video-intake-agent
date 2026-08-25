param(
  [Parameter(Mandatory = $true)][int]$WorkerPid,
  [Parameter(Mandatory = $true)][int]$WatchdogPid,
  [Parameter(Mandatory = $true)][string]$LogPath,
  [Parameter(Mandatory = $true)][long]$StartOffset,
  [Parameter(Mandatory = $true)][string]$VideoId,
  [Parameter(Mandatory = $true)][string]$RunId,
  [int]$TimeoutSeconds = 2400
)

$ErrorActionPreference = "Stop"

function Get-ValidatedWorker {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $WorkerPid"
  if (-not $process) { throw "BOUNDARY_WORKER_NOT_FOUND: $WorkerPid" }
  if ([int]$process.ParentProcessId -ne $WatchdogPid) {
    throw "BOUNDARY_WORKER_PARENT_CHANGED: expected $WatchdogPid, got $($process.ParentProcessId)"
  }
  if ($process.Name -notmatch '^node(?:\.exe)?$' -or $process.CommandLine -notmatch 'run-all-pre-research-pipelines\.mjs') {
    throw "BOUNDARY_WORKER_IDENTITY_INVALID: $($process.Name) $($process.CommandLine)"
  }
  return $process
}

$resolvedLog = (Resolve-Path -LiteralPath $LogPath).Path
[void](Get-ValidatedWorker)
$requestPath = Join-Path (Split-Path -Parent $resolvedLog) "stop-after-result.json"
$requestTemp = "$requestPath.$WorkerPid.tmp"
$request = @{
  worker_pid = $WorkerPid
  watchdog_pid = $WatchdogPid
  video_id = $VideoId
  run_id = $RunId
  created_at = [DateTimeOffset]::Now.ToString('o')
} | ConvertTo-Json -Compress
Set-Content -LiteralPath $requestTemp -Value $request -NoNewline -Encoding utf8
Move-Item -LiteralPath $requestTemp -Destination $requestPath -Force
$deadline = [DateTimeOffset]::Now.AddSeconds($TimeoutSeconds)
$decoder = [Text.UTF8Encoding]::new($false, $true)
$buffer = ""
$bytes = [byte[]]::new(65536)
$stream = [IO.File]::Open($resolvedLog, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
try {
  if ($StartOffset -lt 0 -or $StartOffset -gt $stream.Length) {
    throw "BOUNDARY_OFFSET_INVALID: $StartOffset for length $($stream.Length)"
  }
  [void]$stream.Seek($StartOffset, [IO.SeekOrigin]::Begin)
  while ([DateTimeOffset]::Now -lt $deadline) {
    $read = $stream.Read($bytes, 0, $bytes.Length)
    if ($read -gt 0) {
      $buffer += $decoder.GetString($bytes, 0, $read)
      $lines = $buffer -split "`r?`n"
      $buffer = $lines[-1]
      foreach ($line in $lines[0..([Math]::Max(0, $lines.Length - 2))]) {
        if ($line -match '"event":"video_result"' -and
            $line.Contains(('"video_id":"{0}"' -f $VideoId)) -and
            $line.Contains(('"run_id":"{0}"' -f $RunId))) {
          [void](Get-ValidatedWorker)
          $graceDeadline = [DateTimeOffset]::Now.AddSeconds(10)
          while ([DateTimeOffset]::Now -lt $graceDeadline -and (Get-Process -Id $WorkerPid -ErrorAction SilentlyContinue)) {
            Start-Sleep -Milliseconds 100
          }
          if (Get-Process -Id $WorkerPid -ErrorAction SilentlyContinue) {
            Stop-Process -Id $WorkerPid -Force
            Write-Output ("boundary_stop_fallback pid={0} video={1} run={2} at={3}" -f $WorkerPid, $VideoId, $RunId, [DateTimeOffset]::Now.ToString('o'))
          } else {
            Write-Output ("boundary_stop_cooperative pid={0} video={1} run={2} at={3}" -f $WorkerPid, $VideoId, $RunId, [DateTimeOffset]::Now.ToString('o'))
          }
          exit 0
        }
      }
    } else {
      Start-Sleep -Milliseconds 100
    }
    if (-not (Get-Process -Id $WorkerPid -ErrorAction SilentlyContinue)) {
      throw "BOUNDARY_WORKER_EXITED_BEFORE_RESULT: $WorkerPid"
    }
  }
  throw "BOUNDARY_TIMEOUT: no exact durable result within $TimeoutSeconds seconds"
} finally {
  $stream.Dispose()
  if (Test-Path -LiteralPath $requestTemp) { Remove-Item -LiteralPath $requestTemp -Force }
  if (Test-Path -LiteralPath $requestPath) {
    try {
      $pending = Get-Content -LiteralPath $requestPath -Raw | ConvertFrom-Json
      if ([int]$pending.worker_pid -eq $WorkerPid -and $pending.video_id -eq $VideoId -and $pending.run_id -eq $RunId) {
        Remove-Item -LiteralPath $requestPath -Force
      }
    } catch {
      # Preserve an unreadable request for operator inspection rather than deleting unknown state.
    }
  }
}
