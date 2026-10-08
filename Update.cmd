@echo off
setlocal
cd /d "%~dp0"
rem Gets the latest version. A running Start-Online window notices it by itself:
rem website changes reach players on their next load, and a service restarts
rem only when its own files changed.
git pull --no-edit
if errorlevel 1 (
  echo.
  echo The update did not finish. Read the message above, or send it to whoever made the update.
) else (
  echo.
  echo Updated.
)
pause
