@echo off
title OLYCITY LIVE - Reinstallation
echo.
echo   Arret du script...
schtasks /delete /tn "OlycityLive" /f >nul 2>&1
taskkill /f /im wscript.exe >nul 2>&1
taskkill /f /im node.exe >nul 2>&1
timeout /t 2 /nobreak >nul
echo   Nettoyage...
rd /s /q "%~dp0node_modules" 2>nul
del /f "%~dp0olycity.log" 2>nul
echo   Reinstallation...
cd /d "%~dp0"
call npm install --silent 2>nul
schtasks /create /tn "OlycityLive" /tr "wscript.exe \"%~dp0silent.vbs\"" /sc ONLOGON /rl HIGHEST /f >nul 2>&1
start "" wscript.exe "%~dp0silent.vbs"
timeout /t 2 /nobreak >nul
echo   OLYCITY LIVE reinstalle et relance.
echo.
pause
