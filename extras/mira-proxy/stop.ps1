$ErrorActionPreference = 'Stop'
$pidFile = Join-Path $PSScriptRoot 'proxy.pid'
if (!(Test-Path -LiteralPath $pidFile)) { Write-Host 'No saved proxy process.'; exit 0 }
$proxyProcessId = [int](Get-Content -Raw -LiteralPath $pidFile).Trim()
$proc = Get-CimInstance Win32_Process -Filter "ProcessId=$proxyProcessId"
if (!$proc) { Remove-Item -LiteralPath $pidFile; Write-Host 'Already stopped.'; exit 0 }
$entry = Join-Path $PSScriptRoot 'proxy.cjs'
# Require the full script path so a recycled PID cannot stop a different process.
if ($proc.Name -ne 'node.exe' -or !$proc.CommandLine.Contains($entry)) {
    throw 'Saved PID does not identify this proxy. No process was stopped.'
}
Stop-Process -Id $proxyProcessId
Remove-Item -LiteralPath $pidFile
Write-Host 'Proxy stopped.'
