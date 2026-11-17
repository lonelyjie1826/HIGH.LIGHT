@echo off
title HIGH.LIGHT - restart local server
cd /d "%~dp0"

echo ==========================================================
echo  Step 1: looking for an old server holding port 4173 ...
echo ==========================================================
set FOUND=0
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /C:":4173" ^| findstr /C:"LISTENING"') do (
  set FOUND=1
  echo   Found PID %%P - killing it ...
  taskkill /F /PID %%P >nul 2>nul
)
if "%FOUND%"=="0" echo   Nothing was using port 4173. Good.

timeout /t 2 /nobreak >nul

echo.
echo ==========================================================
echo  Step 2: checking Node.js ...
echo ==========================================================
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [!] Node.js not found on this computer.
  echo  [!] Please install Node.js LTS from https://nodejs.org
  echo.
  pause
  exit /b 1
)
echo   Node.js OK.

echo.
echo ==========================================================
echo  Step 3: starting local server on http://127.0.0.1:4173/
echo  Keep this window OPEN while uploading or publishing.
echo ==========================================================
echo.

start "" "http://127.0.0.1:4173/"
node server.js

echo.
echo ==========================================================
echo  [!] The local server has STOPPED. Exit code: %errorlevel%
echo  [!] Please screenshot this window and send it over.
echo ==========================================================
echo.
pause
