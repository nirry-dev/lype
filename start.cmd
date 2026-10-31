@echo off
rem Starts Iterant and opens its page. Close this window to switch it off.
title Iterant (close this window to switch it off)
cd /d "%~dp0"
node server\index.js --open
