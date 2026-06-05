@echo off
title OLYCITY LIVE
cd /d "%~dp0"
if not exist olycity-live.exe (
    echo   olycity-live.exe introuvable.
    echo   Lance d'abord BUILD.bat pour le generer.
    pause
    exit /b
)
echo   OLYCITY LIVE demarre...
start olycity-live.exe
timeout /t 2 /nobreak >nul
echo   Lance. Ouvre OLYCITY sur le site, onglet Live.
pause
