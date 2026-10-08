@echo off
setlocal
cd /d "%~dp0"
rem Runs the website, the game server and the bridge for players (see tools\host.py).
where py >/dev/null 2>nul
if not errorlevel 1 (
  py -3 tools\host.py
) else (
  python tools\host.py
)
pause
