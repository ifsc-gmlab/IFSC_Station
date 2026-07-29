@echo off
REM ============================================================================
REM IFSC-Station Windows build/pack script (qmake + NSIS)
REM Run from any cmd / PowerShell (admin recommended):
REM   build\windows\build_IFSC-Station_installer.bat
REM Auto-loads MSVC 2019 vcvars, Qt 5.15.2, and NSIS into PATH.
REM Output:
REM   build\staging\IFSC-Station-installer.exe
REM ============================================================================

setlocal EnableExtensions EnableDelayedExpansion

REM --- 0. Resolve project root from this script's location ---
set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "SRC_DIR=%SCRIPT_DIR%\..\.."
for %%I in ("%SRC_DIR%") do set "SRC_DIR=%%~fI"

REM qmake artifacts (Makefile / .obj / .pdb / .pch / qrc_*.cpp) go in build/
REM staging/ subdir holds the deployed tree (EXE + DLL + Qt plugins),
REM matching Qt Creator's release/staging layout.
set "BUILD_DIR=%SRC_DIR%\build"
set "STAGING_DIR=%BUILD_DIR%\staging"

REM --- 0a. Locate toolchains (overridable via env vars) ---
if not defined QT_DIR     set "QT_DIR=D:\Qt\5.15.2\msvc2019_64"
if not defined VCVARS     set "VCVARS=E:\Microsoft Visual Studio 2019\VC\Auxiliary\Build\vcvars64.bat"
if not defined NSIS_DIR   set "NSIS_DIR=C:\Program Files (x86)\NSIS"

REM --- 0b. Self-bootstrap environment (skip if already ready) ---
if "%QGC_ENV_READY%"=="1" goto :env_ready

set HAVE_ERROR=0

REM 1) Load MSVC vcvars64 if cl.exe is not already in PATH
where cl >nul 2>&1
if errorlevel 1 goto :skip_vcvars
if not exist "%VCVARS%" (
    echo [ERROR] vcvars64.bat not found at: %VCVARS%
    echo         Set VCVARS=^<path^> to override.
    set HAVE_ERROR=1
) else (
    echo [env] loading MSVC 2019 from "%VCVARS%"
    call "%VCVARS%" >nul
    if errorlevel 1 (
        echo [ERROR] vcvars64.bat failed.
        set HAVE_ERROR=1
    )
)
:skip_vcvars

REM 2) Add Qt bin to PATH (vcvars overwrote PATH, so re-prepend)
if exist "%QT_DIR%\bin\qmake.exe" (
    echo [env] prepending Qt bin:  %QT_DIR%\bin
    set "PATH=%QT_DIR%\bin;%PATH%"
) else (
    echo [ERROR] qmake.exe not found at: %QT_DIR%\bin\qmake.exe
    echo         Set QT_DIR=^<path^> to override.
    set HAVE_ERROR=1
)

REM 3) Add NSIS bin to PATH
REM    "(x86)" in "Program Files (x86)" breaks cmd if(...) block parsing
REM    when expanded inline, so use goto-style branching.
if exist "%NSIS_DIR%\makensis.exe" goto :nsis_ok
echo [WARN ] NSIS not found at: %NSIS_DIR%  (installer step will be skipped)
set HAVE_MAKENSIS=0
goto :nsis_done
:nsis_ok
echo [env] prepending NSIS bin: %NSIS_DIR%
set "PATH=%NSIS_DIR%;%PATH%"
set HAVE_MAKENSIS=1
:nsis_done

if "%HAVE_ERROR%"=="1" (
    echo.
    echo Environment bootstrap failed. Aborting.
    exit /b 1
)

set QGC_ENV_READY=1
:env_ready

echo.
echo ============================================================
echo  Project root : !SRC_DIR!
echo  Build dir    : !BUILD_DIR!
echo  Staging dir  : !STAGING_DIR!
echo  MSVC         : cl  -  (vcvars loaded)
echo  Qt           : %QT_DIR%
echo  NSIS         : %NSIS_DIR%
echo ============================================================
echo.

REM --- 1. Toolchain self-check ---
set HAVE_ERROR=0
where qmake >nul 2>&1
if errorlevel 1 (
    echo [ERROR] qmake not found in PATH.
    set HAVE_ERROR=1
)
where cl >nul 2>&1
if errorlevel 1 (
    echo [ERROR] cl.exe not found in PATH.
    set HAVE_ERROR=1
)
if "%HAVE_ERROR%"=="1" (
    echo.
    echo Toolchain check failed. Aborting.
    exit /b 1
)

REM --- 2. Force qrc re-embed (qmake does NOT watch .svg/.png mtime) ---
if exist "%BUILD_DIR%\qrc_qgcresources.o"          del /f /q "%BUILD_DIR%\qrc_qgcresources.o"          >nul 2>&1
if exist "%BUILD_DIR%\qrc_qgroundcontrol.o"        del /f /q "%BUILD_DIR%\qrc_qgroundcontrol.o"        >nul 2>&1
if exist "%BUILD_DIR%\qrc_qgcimages.o"             del /f /q "%BUILD_DIR%\qrc_qgcimages.o"             >nul 2>&1
if exist "%BUILD_DIR%\qrc_InstrumentValueIcons.o"  del /f /q "%BUILD_DIR%\qrc_InstrumentValueIcons.o"  >nul 2>&1
if exist "%SRC_DIR%\qgcresources.qrc"               copy /b "%SRC_DIR%\qgcresources.qrc"+,,           >nul
if exist "%SRC_DIR%\qgroundcontrol.qrc"             copy /b "%SRC_DIR%\qgroundcontrol.qrc"+,,         >nul
if exist "%SRC_DIR%\qgcimages.qrc"                  copy /b "%SRC_DIR%\qgcimages.qrc"+,,              >nul

REM --- 2b. Wipe stale build artifacts (root cause of qsggeometry.h(49) and LNK1318) ---
echo [2b] wiping stale PCH + .obj + .pdb + qmake intermediates ...
if exist "%BUILD_DIR%\QGroundControl_pch.pch" del /f /q "%BUILD_DIR%\QGroundControl_pch.pch" >nul 2>&1
if exist "%BUILD_DIR%\QGroundControl_pch.obj" del /f /q "%BUILD_DIR%\QGroundControl_pch.obj" >nul 2>&1
if exist "%BUILD_DIR%\QGroundControl.vc.pdb"  del /f /q "%BUILD_DIR%\QGroundControl.vc.pdb"  >nul 2>&1
del /s /q "%BUILD_DIR%\*.obj"        >nul 2>&1
del /s /q "%BUILD_DIR%\*.pdb"        >nul 2>&1
del /s /q "%BUILD_DIR%\*.pch"        >nul 2>&1
del /s /q "%BUILD_DIR%\*.res"        >nul 2>&1
del /s /q "%BUILD_DIR%\*.rcc"        >nul 2>&1
del /s /q "%BUILD_DIR%\*.idb"        >nul 2>&1
del /s /q "%BUILD_DIR%\*.exp"        >nul 2>&1
del /s /q "%BUILD_DIR%\*.lib"        >nul 2>&1
del /s /q "%BUILD_DIR%\*.ilk"        >nul 2>&1
del /s /q "%BUILD_DIR%\moc_*.cpp"    >nul 2>&1
del /s /q "%BUILD_DIR%\moc_*.h"      >nul 2>&1
del /s /q "%BUILD_DIR%\ui_*.h"       >nul 2>&1
del /s /q "%BUILD_DIR%\qrc_*.cpp"    >nul 2>&1
if exist "%BUILD_DIR%\Makefile"            del /f /q "%BUILD_DIR%\Makefile"            >nul 2>&1
if exist "%BUILD_DIR%\Makefile.Debug"      del /f /q "%BUILD_DIR%\Makefile.Debug"      >nul 2>&1
if exist "%BUILD_DIR%\Makefile.Release"    del /f /q "%BUILD_DIR%\Makefile.Release"    >nul 2>&1
if exist "%BUILD_DIR%\.qmake.stash"        del /f /q "%BUILD_DIR%\.qmake.stash"        >nul 2>&1
if exist "%BUILD_DIR%\QGCLoggingCategory.obj"  del /f /q "%BUILD_DIR%\QGCLoggingCategory.obj"  >nul 2>&1
if exist "%BUILD_DIR%\QGCApplication.obj"      del /f /q "%BUILD_DIR%\QGCApplication.obj"      >nul 2>&1
if exist "%SRC_DIR%\.qtc_clangd"               rmdir /s /q "%SRC_DIR%\.qtc_clangd"              >nul 2>&1
if exist "%BUILD_DIR%\.qtc_clangd"             rmdir /s /q "%BUILD_DIR%\.qtc_clangd"            >nul 2>&1

REM --- 2c. Strip leading UTF-8 BOMs from critical .cc/.h files ---
echo [2c] stripping leading UTF-8 BOMs from critical .cc/.h files ...
if exist "%~dp0strip_bom.ps1" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0strip_bom.ps1"
)

REM --- 3. Prepare build directory ---
if not exist "%BUILD_DIR%"   mkdir "%BUILD_DIR%"
if not exist "%STAGING_DIR%" mkdir "%STAGING_DIR%"

REM --- 4. qmake configure (CONFIG+=installer enables NSIS post-link) ---
echo [1/3] qmake configure ...
pushd "!BUILD_DIR!" >nul
if errorlevel 1 (
    echo [ERROR] pushd failed: !BUILD_DIR!
    exit /b 1
)
qmake ..\qgroundcontrol.pro -spec win32-msvc CONFIG+=release CONFIG+=installer
if errorlevel 1 (
    popd
    echo [ERROR] qmake configure failed.
    exit /b 1
)

REM --- 5. nmake build ---
echo [2/3] nmake build (this can take 20-40 minutes on first run) ...
nmake
if errorlevel 1 (
    popd
    echo [ERROR] nmake build failed.
    exit /b 1
)
popd

REM --- 5b. Force windeployqt (independent of nmake's post-link) ---
REM qmake puts windeployqt in QMAKE_POST_LINK, but nmake only re-runs post-link when it
REM relinks the EXE. On incremental builds where the EXE already exists, nmake skips
REM post-link entirely, so the staging dir would lack Qt DLLs / plugins and the installer
REM would be unusable on a clean machine. Run windeployqt explicitly here every time.
echo [2b] windeployqt -- deploying Qt runtime into staging ...
if exist "%STAGING_DIR%\IFSC-Station.exe" (
    pushd "%BUILD_DIR%" >nul
    if errorlevel 1 (
        echo [ERROR] pushd failed: %BUILD_DIR%
        exit /b 1
    )
    "%QT_DIR%\bin\windeployqt.exe" ^
        --qmldir="%SRC_DIR%\src" ^
        --qmldir="%SRC_DIR%\src\QmlControls" ^
        --qmldir="%SRC_DIR%\src\FlightMap" ^
        --qmldir="%SRC_DIR%\src\FlightDisplay" ^
        --qmldir="%SRC_DIR%\src\MissionManager" ^
        --qmldir="%SRC_DIR%\src\AutoPilotPlugins" ^
        --qmldir="%SRC_DIR%\src\FirmwarePlugin" ^
        --qmldir="%SRC_DIR%\src\AnalyzeView" ^
        --qmldir="%SRC_DIR%\src\PlanView" ^
        --qmldir="%SRC_DIR%\src\Vehicle" ^
        --qmldir="%SRC_DIR%\src\VehicleSetup" ^
        --qmldir="%SRC_DIR%\src\ui" ^
        --no-translations --no-system-d3d-compiler --no-opengl-sw ^
        "staging\IFSC-Station.exe"
    if errorlevel 1 (
        popd
        echo [ERROR] windeployqt failed.
        exit /b 1
    )
    popd
) else (
    echo [WARN ] staging\IFSC-Station.exe not found, skipping windeployqt.
)

REM --- 6. Verify artifacts ---
echo [3/3] verify artifacts ...
if exist "%STAGING_DIR%\IFSC-Station-installer.exe" (
    set FINAL_INSTALLER=%STAGING_DIR%\IFSC-Station-installer.exe
) else (
    if "%HAVE_MAKENSIS%"=="0" (
        echo [WARN ] NSIS not installed, so installer was not produced. Bare EXE may still be available.
    ) else (
        echo [ERROR] Installer not found in %STAGING_DIR%. Check NSIS log above.
    )
    set FINAL_INSTALLER=
)

echo.
echo ============================================================
echo  [DONE]
if defined FINAL_INSTALLER echo   Installer : !FINAL_INSTALLER!
if exist "%STAGING_DIR%\IFSC-Station.exe" echo   Bare EXE  : !STAGING_DIR!\IFSC-Station.exe
echo ============================================================
echo.
echo Build directory tree (depth 2, files-only counts):
if exist "%BUILD_DIR%" (
    for /f "tokens=*" %%D in ('dir /s /b /a-d "%BUILD_DIR%" 2^>nul ^| find /v /c ""') do set FILE_COUNT=%%D
    for /f "tokens=*" %%D in ('dir /s /b /ad "%BUILD_DIR%" 2^>nul ^| find /v /c ""') do set DIR_COUNT=%%D
    echo   !BUILD_DIR!
    echo     total files: !FILE_COUNT!
    echo     total dirs : !DIR_COUNT!
    echo.
    echo Top-level entries in build/:
    dir /b "%BUILD_DIR%" 2>nul
)
echo.
echo Top-level entries in staging/:
if exist "%STAGING_DIR%" dir /b "%STAGING_DIR%" 2>nul
endlocal
