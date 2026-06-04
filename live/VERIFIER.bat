@echo off
title OLYCITY LIVE - Statut

echo.
echo   Verification...
echo.

tasklist /fi "IMAGENAME eq node.exe" 2>nul | find /i "node.exe" >nul
if %errorlevel% equ 0 (
    echo   OLYCITY LIVE tourne en fond. OK
) else (
    echo   OLYCITY LIVE ne tourne PAS.
    echo   Relancement...
    set SCRIPT_DIR=%~dp0
    start "" wscript.exe "%SCRIPT_DIR%silent.vbs"
    timeout /t 2 /nobreak >nul
    echo   Relance en fond.
)

echo.
echo   Derniers logs :
echo   ________________________
type "%~dp0olycity.log" 2>nul | more +999
echo.
pause
