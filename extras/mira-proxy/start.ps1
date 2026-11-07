$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$port = if ($env:MIRA_PROXY_PORT) { [int]$env:MIRA_PROXY_PORT } else { 18890 }
$keyFile = Join-Path $PSScriptRoot '.local-api-key'
if (Test-Path -LiteralPath $keyFile) {
    $key = (Get-Content -Raw -LiteralPath $keyFile).Trim()
    try {
        $health = Invoke-RestMethod "http://127.0.0.1:$port/health" -Headers @{ Authorization = "Bearer $key" } -TimeoutSec 2
        if ($health.upstream -eq 'https://relay.mirasim.ai') {
            Write-Host "Already running: http://127.0.0.1:$port/v1"
            Write-Host "Model: kimi-k3"
            exit 0
        }
    } catch {}
}
$node = (Get-Command node.exe -ErrorAction Stop).Source
$entry = Join-Path $PSScriptRoot 'proxy.cjs'
$proc = Start-Process -FilePath $node -ArgumentList @('"' + $entry + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot 'proxy.log') -RedirectStandardError (Join-Path $PSScriptRoot 'proxy-error.log') -PassThru
$proc.Id | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'proxy.pid')
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 300
    if ($proc.HasExited) { throw 'Proxy exited. Read proxy-error.log.' }
    if (Test-Path -LiteralPath $keyFile) {
        $key = (Get-Content -Raw -LiteralPath $keyFile).Trim()
        try {
            $health = Invoke-RestMethod "http://127.0.0.1:$port/health" -Headers @{Authorization="Bearer $key"} -TimeoutSec 1
            if ($health.upstream -eq 'https://relay.mirasim.ai') {
                Write-Host "Base URL: http://127.0.0.1:$port/v1`nModel: kimi-k3"
                exit 0
            }
        } catch {}
    }
}
throw 'Proxy startup timed out. Read proxy-error.log.'


