<#
    dev-frontend.ps1 —— 启动 Vite 开发服务器（http://localhost:5173）

    Node 装在 C:\Program Files\nodejs，但可能不在当前会话的 PATH 里
    （终端比安装更早打开），所以这里显式补上。
#>
$ErrorActionPreference = 'Stop'

$nodeDir = 'C:\Program Files\nodejs'
if (Test-Path (Join-Path $nodeDir 'npm.cmd')) {
    $env:PATH = "$nodeDir;$env:PATH"
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host '[错误] 找不到 npm（已尝试补上 C:\Program Files\nodejs）' -ForegroundColor Red
    Write-Host '        请确认 Node.js 装在该目录，或直接开一个新终端再试。'
    exit 1
}

$frontend = Join-Path $PSScriptRoot 'frontend'
Push-Location $frontend
try {
    if (-not (Test-Path 'node_modules')) {
        Write-Host '[1/2] node_modules 不存在，执行 npm install ...'
        npm install
        if ($LASTEXITCODE -ne 0) { Write-Host '[错误] npm install 失败' -ForegroundColor Red; exit 1 }
    }
    else {
        Write-Host '[1/2] node_modules 已存在，跳过安装'
    }

    Write-Host ''
    Write-Host '[2/2] 启动 Vite：http://localhost:5173' -ForegroundColor Green
    npm run dev
}
finally {
    Pop-Location
}
