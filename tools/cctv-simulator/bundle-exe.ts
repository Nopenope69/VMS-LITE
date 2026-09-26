import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.resolve(__dirname, 'dist');

if (!fs.existsSync(DIST_DIR)) {
  fs.mkdirSync(DIST_DIR, { recursive: true });
}

console.log('Building standalone CCTV Simulator distribution...');

// Create portable launcher script
const launcherContent = `@echo off
title Universal CCTV Camera & NVR Simulator
echo ===================================================================
echo  Starting Universal CCTV Simulator on port 8190...
echo ===================================================================
node "%~dp0\\..\\server.js" %*
if %ERRORLEVEL% NEQ 0 (
  npx tsx "%~dp0\\..\\server.ts" %*
)
pause
`;

fs.writeFileSync(path.resolve(DIST_DIR, 'cctv-simulator.cmd'), launcherContent, 'utf-8');
console.log('Generated portable launcher: tools/cctv-simulator/dist/cctv-simulator.cmd');
