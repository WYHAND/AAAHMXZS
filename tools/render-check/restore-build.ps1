# Restores the frontend build to its default config (no VITE_API_BASE override),
# so the working tree is left exactly as it was found.
# ASCII only - Windows PowerShell 5.1 parses .ps1 as ANSI without BOM.
$env:PATH = "C:\Program Files\nodejs;" + $env:PATH
$ErrorActionPreference = "Continue"

if (Test-Path Env:\VITE_API_BASE) { Remove-Item Env:\VITE_API_BASE }

Set-Location frontend
Write-Output "=== rebuild with default .env (VITE_API_BASE=/api/v1) ==="
npm run build 2>&1 | Select-String -Pattern "built in|error|dist/" | Select-Object -Last 10
