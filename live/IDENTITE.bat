@echo off
setlocal
title OLYCITY LIVE - Changer de joueur
set "SCRIPT_DIR=%~dp0"
set "NODE_EXE=%SCRIPT_DIR%runtime\node.exe"

if not exist "%NODE_EXE%" (
    echo   [ERREUR] Runtime portable manquant.
    pause
    exit /b
)

rem --force : redemande meme si une identite est deja enregistree.
"%NODE_EXE%" "%SCRIPT_DIR%ask-identity.js" --force

echo   Redemarrage d'OLYCITY LIVE pour appliquer le changement...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%manage.ps1" stop >nul 2>&1
start "" wscript.exe "%SCRIPT_DIR%silent.vbs"
timeout /t 2 /nobreak >nul
echo.
pause
