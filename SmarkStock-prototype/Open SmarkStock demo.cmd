@echo off
title SmarkStock demo
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is required. Install it from https://nodejs.org then run this again. & pause & exit /b)
echo Starting SmarkStock demo... a browser tab will open. PIN is 1947.
node server.js
pause
