@echo off
chcp 65001 >nul
title OLYCITY LIVE — Desinstallation

echo.
echo   Suppression de la tache planifiee...
schtasks /delete /tn "OlycityLive" /f >nul 2>&1
taskkill /f /im wscript.exe >nul 2>&1
taskkill /f /im node.exe >nul 2>&1
echo   OLYCITY LIVE arrete et desinstalle.
echo.
pause
