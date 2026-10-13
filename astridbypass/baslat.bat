@echo off
chcp 65001 >nul
title BadSupDev Web Sunucusu
echo ========================================================
echo              BADSUPDEV WEB SUNUCUSU
echo ========================================================
echo.
echo [1/2] Sunucu ve Shopier API baslatiliyor...
echo [2/2] Tarayici aciliyor: http://localhost:3000
echo.
echo * Admin Paneli: http://localhost:3000/admin
echo   Kullanici Adi: BadSupDev
echo   Sifre: bAdSupDev^24)312
echo.
echo Durdurmak icin pencereyi kapatin veya Ctrl+C yapin.
echo --------------------------------------------------------
python server.py
pause
