@echo off
rem Starts the Fortitudo model proxy. Put your secret in token.txt next to this file
rem (one line, the same value as AGENT_MODEL_TOKEN in Vercel). token.txt is never committed.
cd /d "%~dp0"
if not exist token.txt (
  echo Create token.txt next to this file with your AGENT_MODEL_TOKEN in it.
  pause
  exit /b 1
)
set /p AGENT_MODEL_TOKEN=<token.txt
node proxy.mjs
