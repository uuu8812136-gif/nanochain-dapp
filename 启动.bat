@echo off
chcp 65001 >nul
title NanoChain 迷你区块链 DApp
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 if exist "%ProgramFiles%\nodejs\npm.cmd" set "PATH=%ProgramFiles%\nodejs;%PATH%"
where npm >nul 2>nul
if errorlevel 1 (
  echo 未找到 Node.js，请先到 https://nodejs.org 安装后再运行。
  pause
  exit /b 1
)

if not exist node_modules (
  echo 首次运行，正在安装依赖，请稍候...
  call npm install || (pause & exit /b 1)
)

call npm start
pause