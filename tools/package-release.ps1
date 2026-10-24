param(
    [string]$Version = "v1.0.0"
)

$ErrorActionPreference = "Stop"

# Build a source-only zip for reviewers: no .env, no venv/node_modules, no local DB.
$root = Split-Path -Parent $PSScriptRoot
$staging = Join-Path $env:TEMP ("aicareer-package-" + [guid]::NewGuid().ToString("N"))
$outDir = Join-Path $root "release"
New-Item -ItemType Directory -Force -Path $staging, $outDir | Out-Null

$excludeDirs = @(
    ".git", "node_modules", "venv", ".venv", "dist", "build", "release", "__pycache__",
    ".pytest_cache", ".vscode", ".idea", "uploads"
)
$excludePaths = @(
    (Join-Path $root "backend\data"),
    # Keep audit screenshots in the repo as evidence, but exclude them from the source zip.
    (Join-Path $root "tools\render-check\audit")
)
$robocopyArgs = @($root, $staging, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP", "/XD") + $excludeDirs
$robocopyArgs += $excludePaths
$robocopyArgs += @("/XF", ".env", ".env.local", "*.db", "*.sqlite", "*.log", "*.pyc")
& robocopy @robocopyArgs | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }

# 1) No real env file may enter the package.
$envFiles = Get-ChildItem $staging -Recurse -Force -File | Where-Object {
    $_.Name -eq ".env" -or $_.Name -like ".env.*.local"
}
if ($envFiles) {
    throw ("secret env file found in package: " + ($envFiles.FullName -join ", "))
}

# 2) No API keys / tokens in text files.
$patterns = @(
    "sk-[A-Za-z0-9]{32}",
    "ghp_[A-Za-z0-9]{36}",
    "github_pat_[A-Za-z0-9_]{20,}",
    "LTAI[0-9A-Za-z]{16}",
    "-----BEGIN [A-Z ]*PRIVATE KEY-----"
)
$hits = Get-ChildItem $staging -Recurse -File -Include *.py, *.ts, *.tsx, *.js, *.mjs, *.json, *.md, *.txt, *.yml, *.yaml, *.ps1, *.example |
    Select-String -Pattern $patterns
if ($hits) {
    throw ("possible secret found: " + (($hits | ForEach-Object { "$($_.Path):$($_.LineNumber)" }) -join ", "))
}

$zip = Join-Path $outDir ("ai-career-demo-" + $Version + ".zip")
if (Test-Path $zip) { Remove-Item $zip -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($staging, $zip, [System.IO.Compression.CompressionLevel]::Optimal, $false)
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash
"$hash  $(Split-Path $zip -Leaf)" | Set-Content ($zip + ".sha256") -Encoding ASCII
Remove-Item $staging -Recurse -Force

$sizeMb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Output "PACKAGE OK: $zip"
Write-Output "SIZE: $sizeMb MB"
Write-Output "SHA256: $hash"
Write-Output "Checked: no .env, no venv/node_modules, no local DB, no API key patterns."
