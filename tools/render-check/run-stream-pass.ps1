# Runs the real-streaming verification pass (scenario C, strong version).
# ASCII only - Windows PowerShell 5.1 parses .ps1 as ANSI without BOM.
$env:PATH = "C:\Program Files\nodejs;" + $env:PATH
$ErrorActionPreference = "Stop"

Set-Location frontend
Write-Output "=== build with VITE_API_BASE=http://127.0.0.1:4174/api/v1 ==="
$env:VITE_API_BASE = "http://127.0.0.1:4174/api/v1"
npm run build 2>&1 | Select-Object -Last 8
Remove-Item Env:\VITE_API_BASE
