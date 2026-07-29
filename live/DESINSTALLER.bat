@echo off
title OLYCITY LIVE - Desinstallation
set "SCRIPT_DIR=%~dp0"
set "NODE_EXE=%SCRIPT_DIR%runtime\node.exe"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%manage.ps1" stop >nul 2>&1
schtasks /delete /tn "OlycityLive" /f >nul 2>&1
if exist "%NODE_EXE%" "%NODE_EXE%" "%SCRIPT_DIR%startup.js" remove >nul 2>&1
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\OLYCITY-Live.vbs" >nul 2>&1
echo   OLYCITY LIVE desinstalle.
pause
