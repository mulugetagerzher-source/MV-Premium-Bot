@echo off
title VIP Telegram Bot Runner
cd /d "%~dp0"
echo ====================================================
echo Starting VIP Telegram Bot with Supabase Integration...
echo ====================================================
:loop
python main.py
echo.
echo [!] Bot process ended. Restarting in 5 seconds... (Press Ctrl+C to stop)
timeout /t 5
goto loop
