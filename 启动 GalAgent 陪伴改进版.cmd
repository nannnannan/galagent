@echo off
setlocal
cd /d "%~dp0"
if not exist "release\companion-quality\win-unpacked\GalAgent.exe" (
  echo Companion quality build was not found. Build release/companion-quality first.
  pause
  exit /b 1
)
start "" "release\companion-quality\win-unpacked\GalAgent.exe"
