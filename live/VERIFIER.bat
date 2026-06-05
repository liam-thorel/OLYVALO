@echo off
title OLYCITY LIVE - Statut

echo.
echo   Verification des modules...
set SCRIPT_DIR=%~dp0
cd /d "%SCRIPT_DIR%"
call npm install --silent 2>nul
echo   Modules OK
echo.

tasklist /fi "IMAGENAME eq node.exe" 2>nul | find /i "node.exe" >nul
if %errorlevel% equ 0 (
    echo   OLYCITY LIVE tourne en fond.
) else (
    echo   Lancement en arriere-plan...
    start "" wscript.exe "%SCRIPT_DIR%silent.vbs"
    timeout /t 3 /nobreak >nul
    echo   Lance.
)

echo.
echo   Derniers logs :
echo   ________________________
if exist "%SCRIPT_DIR%olycity.log" (
    powershell -Command "Get-Content '%SCRIPT_DIR%olycity.log' -Encoding UTF8 -Tail 30"
) else (
    echo   Pas encore de logs.
)
echo.
pause
