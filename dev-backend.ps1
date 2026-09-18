<#
    dev-backend.ps1 —— 建表灌种子 + 启动 FastAPI（http://localhost:8000）

    默认使用 SQLite；想换 PostgreSQL，先设置 $env:DATABASE_URL 再运行本脚本。
#>
$ErrorActionPreference = 'Stop'

$backend = Join-Path $PSScriptRoot 'backend'
$venvPy = Join-Path $backend 'venv\Scripts\python.exe'

if (-not (Test-Path $venvPy)) {
    Write-Host "[错误] 找不到 venv：$venvPy" -ForegroundColor Red
    Write-Host '        请先运行：.\setup-backend.ps1'
    exit 1
}

Push-Location $backend
try {
    if (-not (Test-Path 'data')) { New-Item -ItemType Directory -Path 'data' | Out-Null }
    if (-not $env:DATABASE_URL) { $env:DATABASE_URL = 'sqlite:///./data/app.db' }
    if (-not $env:APP_ENV) { $env:APP_ENV = 'development' }
    if (-not $env:DEBUG) { $env:DEBUG = 'true' }

    Write-Host '[1/2] 初始化数据库（幂等，重复执行不会重复插数据） ...'
    & $venvPy -m app.db.init_db
    if ($LASTEXITCODE -ne 0) { Write-Host '[错误] 初始化数据库失败' -ForegroundColor Red; exit 1 }

    if (-not $env:DEEPSEEK_API_KEY) {
        Write-Host '[提示] 未配置 DEEPSEEK_API_KEY，AI 能力会走 7.6 兜底话术（不是报错）' -ForegroundColor Yellow
    }

    Write-Host ''
    Write-Host '[2/2] 启动 uvicorn：http://localhost:8000    接口文档：/docs' -ForegroundColor Green
    & $venvPy -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
}
finally {
    Pop-Location
}
