@echo off
setlocal
title OLYCITY LIVE - Sonde skins
set "SCRIPT_DIR=%~dp0"
set "NODE_EXE=%SCRIPT_DIR%runtime\node.exe"

if not exist "%NODE_EXE%" (
    echo   [ERREUR] Runtime portable manquant.
    pause
    exit /b
)

echo.
echo   Lance cette sonde PENDANT une partie Valorant.
echo   Pas en agent select : les skins adverses n'existent
echo   qu'une fois la partie lancee.
echo.
echo   Lecture seule : rien n'est envoye, rien n'est modifie.
echo.
pause

"%NODE_EXE%" "%SCRIPT_DIR%probe-loadouts.js"

echo.
pause
