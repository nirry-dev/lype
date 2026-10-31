@echo off
rem Starts Lype and opens its page. Close this window to switch it off.
title Lype (close this window to switch it off)
cd /d "%~dp0"
node server\index.js --open
