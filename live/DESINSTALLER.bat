@echo off
title OLYCITY LIVE - Desinstallation
set "SCRIPT_DIR=%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%manage.ps1" stop >nul 2>&1
schtasks /delete /tn "OlycityLive" /f >nul 2>&1
echo   OLYCITY LIVE desinstalle.
pause
