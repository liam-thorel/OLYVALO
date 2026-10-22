@echo off
setlocal
title OLYCITY LIVE - Livechat
set "SCRIPT_DIR=%~dp0"
set "NODE_EXE=%SCRIPT_DIR%runtime\node.exe"

if not exist "%NODE_EXE%" (
    echo   [ERREUR] Runtime portable manquant.
    pause
    exit /b
)

rem Le reglage est relu a chaque media : pas besoin de redemarrer le script.
"%NODE_EXE%" "%SCRIPT_DIR%livechat-settings.js"
echo.
pause
