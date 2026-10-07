@echo off
setlocal
cd /d "%~dp0"
if not exist "tools\serve.py" (
  echo Copy this update into your existing Boxhead-Revamp repository folder first.
  echo It belongs alongside README.md, client, and tools.
  pause
  exit /b 1
)
where py >nul 2>nul
if not errorlevel 1 (
  start "" "http://localhost:8080/"
  py -3 tools\serve.py
) else (
  where python >nul 2>nul
  if errorlevel 1 (
    echo Python was not found. Use the Python installation that runs your current game.
    pause
    exit /b 1
  )
  start "" "http://localhost:8080/"
  python tools\serve.py
)
pause
