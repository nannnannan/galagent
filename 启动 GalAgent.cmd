@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$ok = $false; try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:18890/v1/models' -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop; $ok = ($r.StatusCode -ge 200) } catch {}; $s = Join-Path ([Environment]::GetFolderPath('Desktop')) 'mira反代\kimi-api\start.ps1'; if (-not $ok -and (Test-Path $s)) { & $s | Out-Null }"
start "" "%~dp0release\dual-core\win-unpacked\GalAgent.exe"
