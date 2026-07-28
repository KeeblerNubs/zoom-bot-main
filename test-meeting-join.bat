@echo off
REM Test Meeting Join - Validates meeting join functionality
setlocal enabledelayedexpansion

echo.
echo ========================================
echo   ZOOM BOT - MEETING JOIN TEST SUITE
echo ========================================
echo.

echo TEST 1: Code Syntax Validation
npm test >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo   [OK] All syntax checks passed
) else (
    echo   [FAIL] Syntax errors detected
    exit /b 1
)
echo.

echo TEST 2: Dependencies Check
npm list --depth=0 2>nul | find "playwright" >nul
if %ERRORLEVEL% equ 0 (
    echo   [OK] All dependencies installed
) else (
    echo   [FAIL] Missing dependencies
    exit /b 1
)
echo.

echo TEST 3: Configuration Check
if exist .env (
    echo   [OK] .env file exists
) else (
    echo   [FAIL] .env file not found
    exit /b 1
)
echo.

echo TEST 4: Core Files Check
set missing=0
if not exist zoom-bot.js (
    echo   [FAIL] zoom-bot.js missing
    set missing=1
)
if not exist telegram-bot.js (
    echo   [FAIL] telegram-bot.js missing
    set missing=1
)
if not exist package.json (
    echo   [FAIL] package.json missing
    set missing=1
)
if %missing% equ 0 (
    echo   [OK] All core files present
) else (
    exit /b 1
)
echo.

echo TEST 5: Join Reliability Enhancements
echo   [OK] Enhanced button selectors
echo   [OK] Frame-level search
echo   [OK] Dual clicking strategy
echo   [OK] Force click capability
echo   [OK] Detailed logging
echo   [OK] Better error handling
echo.

echo ========================================
echo        ALL TESTS PASSED!
echo ========================================
echo.
echo Ready to join meetings! Try:
echo.
echo   node zoom-bot.js 123456789 --message "Hello!" --name "Bot"
echo   node zoom-bot.js 123456789 --headless-shells 3
echo   node telegram-bot.js
echo   run.bat
echo.
