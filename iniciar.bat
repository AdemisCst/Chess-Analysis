@echo off
title Acervo 64 - servidor local
cd /d "%~dp0"
echo Iniciando o Acervo 64...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0servidor.ps1"
pause
