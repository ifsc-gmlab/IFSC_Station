@echo off
REM ============================================================
REM  IFSC-Station Web Starter (Windows / Windows Server 2016+)
REM  Pure ASCII - works on any code page (GBK / UTF-8 / 1252)
REM  Requires Python 3.8+ on PATH.
REM  Download: https://www.python.org/downloads/
REM  IMPORTANT: tick "Add Python to PATH" during install.
REM
REM  Usage (double-click, or in cmd):
REM    start.bat                       default port 8000, open browser
REM    start.bat -p 9000               custom HTTP port
REM    start.bat --bind 0.0.0.0        allow LAN / server access
REM    start.bat --no-browser          don't open browser
REM    start.bat --no-bridge           don't auto-start WebSocket bridge
REM ============================================================
setlocal enabledelayedexpansion

REM ---- Detect Python: try py -3, then python3, then python ----
set "PY="
where py >nul 2>&1
if not errorlevel 1 set "PY=py -3"
if not defined PY (
    where python3 >nul 2>&1
    if not errorlevel 1 set "PY=python3"
)
if not defined PY (
    where python >nul 2>&1
    if not errorlevel 1 set "PY=python"
)

if not defined PY (
    echo.
    echo ============================================================
    echo   Python not found
    echo ============================================================
    echo   Please install Python 3.8+ and tick "Add Python to PATH":
    echo     https://www.python.org/downloads/
    echo   Then double-click this script again.
    echo.
    echo   Server 2022 note: if Python is installed but not found,
    echo   open "Edit the system environment variables" -^> PATH,
    echo     add: C:\Users\YOUR_USER\AppData\Local\Programs\Python\Python3X\
    echo     add: C:\Users\YOUR_USER\AppData\Local\Programs\Python\Python3X\Scripts\
    echo ============================================================
    echo.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo   IFSC-Station Web Starter
echo   Python : %PY%
echo   Folder : %~dp0
echo   URL    : http://localhost:8000/
echo ============================================================
echo   Notes:
echo   - Windows / Server uses Web Serial (browser-to-USB),
echo     no WebSocket bridge needed.
echo   - LAN / server access: start.bat --bind 0.0.0.0
echo   - Port in use? Auto try 8001-8010, or: start.bat -p 9000
echo ============================================================
echo.

cd /d "%~dp0"
%PY% start.py %*

if errorlevel 1 (
    echo.
    echo   [FAILED] exit code !errorlevel!
    echo   Try: start.bat -p 9000
    echo.
)

echo.
echo Press any key to exit...
pause >nul
endlocal