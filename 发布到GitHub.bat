@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "%~dp0publish-to-github.ps1"
pause
