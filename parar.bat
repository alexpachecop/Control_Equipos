@echo off
echo Parando Control de Equipos...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":4000 " ^| findstr "LISTENING"') do (
  taskkill /PID %%a /F >nul 2>&1
)
echo Servidor parado.
timeout /t 2 >nul
