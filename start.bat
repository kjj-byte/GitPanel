@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"

title GitHub Account Panel

if not "%~1"=="" (
  set "PORT=%~1"
  for /f "delims=0123456789" %%A in ("!PORT!") do set "BAD_PORT=1"
  if defined BAD_PORT (
    echo.
    echo [ERROR] Port must be a number.
    echo.
    pause
    exit /b 1
  )
)

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERROR] Node.js was not found in PATH.
  echo Install Node.js 20.11 or newer from https://nodejs.org/
  echo.
  pause
  exit /b 1
)

if not exist "server.mjs" (
  echo.
  echo [ERROR] server.mjs was not found.
  echo Keep start.bat in the project folder.
  echo.
  pause
  exit /b 1
)

echo.
echo   GitHub Account Panel
echo   Starting... a browser will open when the server is ready.
echo   Press Ctrl+C to stop the server.
echo.

rem server.mjs opens the browser itself using the REAL url (after any port
rem auto-scan), so the bat must NOT open a guessed port - that was why the
rem browser hit a port the server was not listening on (cannot reach site).
call node "server.mjs"
set "EXIT_CODE=%ERRORLEVEL%"

if %EXIT_CODE% GTR 0 (
  echo.
  echo Server stopped with exit code %EXIT_CODE%.
  pause
)

endlocal & exit /b %EXIT_CODE%
