@echo off
rem Starts Forge with a visible console (handy for seeing errors). For everyday use, double-click Forge.vbs instead.
cd /d "%~dp0"
start "" http://localhost:4747
node server.js
