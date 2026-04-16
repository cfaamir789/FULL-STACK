@echo off
echo ==========================================
echo   LIVE DEV MODE - USB Hot Reload
echo   Save any file = phone updates instantly
echo ==========================================
echo.
echo Make sure:
echo   1. Phone connected via USB
echo   2. USB Debugging ON in Developer Options
echo   3. EAS app UNINSTALLED from phone (first time only)
echo.
cd /d "%~dp0"
npx expo run:android
