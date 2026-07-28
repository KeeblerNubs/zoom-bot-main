#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Quick launcher for Zoom Bot - handles common scenarios
.DESCRIPTION
  Provides interactive menu to run Zoom Bot or Telegram relay
.EXAMPLE
  .\run.ps1
#>

# Ensure Tesseract is in PATH
if (-not ($env:Path -like '*Tesseract*')) {
    $tesseractPath = "C:\Program Files\Tesseract-OCR"
    if (Test-Path "$tesseractPath\tesseract.exe") {
        $env:Path += ";$tesseractPath"
        [Environment]::SetEnvironmentVariable("Path", $env:Path, "User")
    }
}

function Show-Menu {
    Write-Host "`n=== ZOOM BOT LAUNCHER ===" -ForegroundColor Cyan
    Write-Host "1. Run Zoom Bot (interactive - will prompt for meeting ID)"
    Write-Host "2. Run Zoom Bot with meeting ID and message"
    Write-Host "3. Run Zoom Bot with multiple parallel shells"
    Write-Host "4. Run Telegram Relay Bot"
    Write-Host "5. Run tests"
    Write-Host "6. Exit"
    Write-Host ""
}

function Start-InteractiveZoomBot {
    Write-Host "Starting Zoom Bot (interactive mode)..." -ForegroundColor Green
    node zoom-bot.js
}

function Start-ZoomBotWithArgs {
    $meetingId = Read-Host "Enter Zoom meeting ID or link"
    if (-not $meetingId) {
        Write-Host "Meeting ID required!" -ForegroundColor Red
        return
    }
    
    $name = Read-Host "Enter display name (leave empty for random)"
    $message = Read-Host "Enter chat message"
    
    $args = @("zoom-bot.js", $meetingId)
    if ($name) {
        $args += @("--name", $name)
    }
    if ($message) {
        $args += @("--message", $message)
    }
    
    Write-Host "Starting Zoom Bot..." -ForegroundColor Green
    Write-Host "Command: node zoom-bot.js $meetingId $(if ($name) { "--name `"$name`"" }) $(if ($message) { "--message `"$message`"" })" -ForegroundColor DarkGray
    & node @args
}

function Start-ZoomBotMultiShell {
    $meetingId = Read-Host "Enter Zoom meeting ID"
    if (-not $meetingId) {
        Write-Host "Meeting ID required!" -ForegroundColor Red
        return
    }
    
    $shellCount = Read-Host "How many parallel shells? (default: 3)"
    $shellCount = [int]($shellCount -or 3)
    
    $message = Read-Host "Enter chat message"
    
    $args = @("zoom-bot.js", $meetingId, "--headless-shells", "$shellCount")
    if ($message) {
        $args += @("--message", $message)
    }
    
    Write-Host "Starting Zoom Bot with $shellCount shell(s)..." -ForegroundColor Green
    Write-Host "Command: node zoom-bot.js $meetingId --headless-shells $shellCount $(if ($message) { "--message `"$message`"" })" -ForegroundColor DarkGray
    & node @args
}

function Start-TelegramBot {
    if (-not $env:TELEGRAM_BOT_TOKEN) {
        Write-Host "ERROR: TELEGRAM_BOT_TOKEN not set in .env!" -ForegroundColor Red
        return
    }
    
    Write-Host "Starting Telegram Bot..." -ForegroundColor Green
    Write-Host "Bot is running and listening for messages..." -ForegroundColor Yellow
    node telegram-bot.js
}

function Run-Tests {
    Write-Host "Running tests..." -ForegroundColor Green
    npm test
}

# Main loop
do {
    Show-Menu
    $choice = Read-Host "Select option (1-6)"
    
    switch ($choice) {
        "1" { Start-InteractiveZoomBot }
        "2" { Start-ZoomBotWithArgs }
        "3" { Start-ZoomBotMultiShell }
        "4" { Start-TelegramBot }
        "5" { Run-Tests }
        "6" { Write-Host "Goodbye!" -ForegroundColor Green; exit }
        default { Write-Host "Invalid choice" -ForegroundColor Red }
    }
} while ($true)
