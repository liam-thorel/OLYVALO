@echo off
title OLYCITY LIVE - Build EXE

echo.
echo   OLYCITY LIVE - Build .exe
echo   ========================
echo.

where python >nul 2>&1
if %errorlevel% neq 0 (
    echo   Python non installe - telechargement...
    start https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe
    echo   Installe Python (coche Add to PATH) puis relance ce fichier.
    pause
    exit /b
)
echo   Python OK

echo   Installation de PyInstaller...
pip install pyinstaller --quiet
echo   PyInstaller OK

echo   Build en cours (environ 30 secondes)...
cd /d "%~dp0"
pyinstaller --onefile --noconsole --name olycity-live olycity_live.py

if exist dist\olycity-live.exe (
    copy dist\olycity-live.exe olycity-live.exe >nul
    echo.
    echo   ========================
    echo   Build termine !
    echo   Fichier : olycity-live.exe
    echo   Distribuable sans Node.js ni Python.
    echo   ========================
) else (
    echo   Erreur lors du build.
)
echo.
pause
