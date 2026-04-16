@echo off
echo ==========================================
echo   LOCAL APK BUILDER
echo ==========================================
echo.

cd /d "%~dp0"

REM Check if release keystore exists, else fall back to debug (for local testing only)
IF EXIST "android\app\release.keystore" (
    echo Using RELEASE keystore - APK installs over EAS app
    IF "%KEYSTORE_PASSWORD%"=="" (
        echo ERROR: Set these env vars first:
        echo   set KEYSTORE_PASSWORD=your_password
        echo   set KEY_ALIAS=your_alias
        echo   set KEY_PASSWORD=your_key_password
        echo.
        echo Or run: setup-keystore.bat
        pause
        exit /b 1
    )
) ELSE (
    echo NOTE: No release.keystore found - using DEBUG signing
    echo       First time: Uninstall the EAS app from your phone
    echo       Then this APK will install fine for local testing
    echo.
    REM Temporarily point release config to debug keystore
    set KEYSTORE_FILE=debug.keystore
    set KEYSTORE_PASSWORD=android
    set KEY_ALIAS=androiddebugkey
    set KEY_PASSWORD=android
)

echo Building APK... (takes 1-3 min)
echo.

cd android
call gradlew.bat assembleRelease --quiet

IF %ERRORLEVEL% NEQ 0 (
    echo.
    echo BUILD FAILED - Check errors above
    pause
    exit /b 1
)

echo.
echo ==========================================
echo   BUILD SUCCESS!
echo ==========================================
echo.
echo APK is here:
echo   %~dp0android\app\build\outputs\apk\release\app-release.apk
echo.

REM Copy to Desktop for easy access
copy /Y "app\build\outputs\apk\release\app-release.apk" "%USERPROFILE%\Desktop\InventoryApp-local.apk" >nul
echo Also copied to Desktop as: InventoryApp-local.apk
echo.
echo Transfer to phone via USB cable, WhatsApp, or email
echo.
pause
