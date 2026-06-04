@echo off
title OLYCITY LIVE - Desinstallation

schtasks /delete /tn "OlycityLive" /f >nul 2>&1
taskkill /f /im wscript.exe >nul 2>&1

echo   OLYCITY LIVE desinstalle.
pause
