@echo off
title OLYCITY LIVE
set SCRIPT_DIR=%~dp0
set NODE_EXE=%SCRIPT_DIR%runtime\node.exe

if not exist "%NODE_EXE%" (
    echo   Runtime portable manquant - retelcharge le ZIP officiel.
    pause & exit /b
)

cd /d "%SCRIPT_DIR%"
if not exist node_modules\ws\index.js (
    echo   Dependances embarquees manquantes - retelcharge le ZIP officiel.
    pause & exit /b
)

start "" /min "%NODE_EXE%" "%SCRIPT_DIR%index.js"
echo   OLYCITY LIVE demarre en arriere-plan.
timeout /t 2 /nobreak >nul
