@echo off
title Universal CCTV Camera & NVR Simulator
cd /d "%~dp0"
echo ===================================================================
echo  Universal CCTV Camera & NVR Simulator (Standby Utility)
echo ===================================================================
echo  Starting on http://localhost:8190 ...
echo ===================================================================
npx tsx tools/cctv-simulator/server.ts
pause
