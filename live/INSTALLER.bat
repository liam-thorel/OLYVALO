@echo off
chcp 65001 >nul
title OLYCITY LIVE — Installation

echo.
echo   OLYCITY LIVE — Setup
echo   ========================
echo.

node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo   Node.js n'est pas installe.
    echo.
    echo   Le navigateur va s'ouvrir pour le telecharger.
    echo   Installe-le, puis relance ce fichier.
    echo.
    start https://nodejs.org/dist/v20.19.0/node-v20.19.0-x64.msi
    pause
    exit
)

echo   Node.js OK
echo   Installation des modules...
echo.

call npm install --silent 2>nul

echo   Installation terminee.
echo.
echo   Tu peux maintenant lancer LANCER.bat avant chaque game.
echo.
pause
