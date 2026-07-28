@echo off
REM Quick launcher for Zoom Bot

:menu
cls
echo.
echo ===== ZOOM BOT LAUNCHER =====
echo.
echo 1. Run Zoom Bot (interactive)
echo 2. Run Zoom Bot with meeting ID
echo 3. Run Telegram Relay Bot
echo 4. Run Tests
echo 5. Exit
echo.
set /p choice="Select option (1-5): "

if "%choice%"=="1" goto interactive
if "%choice%"=="2" goto withargs
if "%choice%"=="3" goto telegram
if "%choice%"=="4" goto tests
if "%choice%"=="5" exit /b 0

echo Invalid choice
timeout /t 2
goto menu

:interactive
echo Starting Zoom Bot...
node zoom-bot.js
pause
goto menu

:withargs
set /p meeting="Enter Zoom meeting ID: "
set /p message="Enter chat message: "
set /p name="Enter display name (optional): "

if "%name%"=="" (
    node zoom-bot.js %meeting% --message "%message%"
) else (
    node zoom-bot.js %meeting% --message "%message%" --name "%name%"
)
pause
goto menu

:telegram
echo Starting Telegram Bot...
echo Bot is running and listening for messages...
node telegram-bot.js
pause
goto menu

:tests
echo Running tests...
npm test
pause
goto menu
