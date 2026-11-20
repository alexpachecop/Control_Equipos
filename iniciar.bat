@echo off
title Control de Equipos

:: Matar proceso previo en puerto 4000 si existe
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":4000 " ^| findstr "LISTENING"') do (
  taskkill /PID %%a /F >nul 2>&1
)
timeout /t 1 >nul

echo Arrancando Control de Equipos en http://localhost:4000
start "" http://localhost:4000
node "%~dp0server.js"
pause
