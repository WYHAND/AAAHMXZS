<#
    dev-backend.ps1 —— 建表灌种子 + 启动 FastAPI（http://localhost:8000）

    默认使用 SQLite；想换 PostgreSQL，先设置 $env:DATABASE_URL 再运行本脚本。

    ⚠️ 本文件必须保存为 UTF-8 **with BOM**：Windows PowerShell 5.1 读无 BOM 的 .ps1
    会按 ANSI(GBK) 解析，中文会乱码并可能导致语法错误。
    注意：用「局部替换」类工具改本文件可能会**把 BOM 抹掉**（实际踩过），
    改完请确认前三字节仍是 EF BB BF。
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
        # 密钥放在 backend\.env 里是**正常做法**，不能只看环境变量，否则会打出假警报
        # （本脚本第一版就是这么错的，还据此误判过"AI 没接上"）。
        $envFile = Join-Path $backend '.env'
        $hasKeyInFile = $false
        if (Test-Path $envFile) {
            $hasKeyInFile = [bool](Select-String -Path $envFile -Pattern '^\s*DEEPSEEK_API_KEY=sk-(?!xxx)' -Quiet)
        }
        if ($hasKeyInFile) {
            Write-Host '[提示] DEEPSEEK_API_KEY 将从 backend\.env 读取（未走环境变量），AI 能力可用' -ForegroundColor DarkGray
        }
        else {
            Write-Host '[提示] 未找到可用的 DEEPSEEK_API_KEY（环境变量与 backend\.env 都没有）。' -ForegroundColor Yellow
            Write-Host '        AI 能力会走 7.6 兜底话术（不是报错）。配置参考 .env.example。' -ForegroundColor Yellow
        }
    }

    Write-Host ''
    Write-Host '[2/2] 启动 uvicorn：http://localhost:8000    接口文档：/docs' -ForegroundColor Green
    & $venvPy -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
}
finally {
    Pop-Location
}
