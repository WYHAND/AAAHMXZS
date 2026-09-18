<#
    setup-backend.ps1 —— 建 venv + 装 Python 依赖（幂等，可反复运行）

    为什么脚本里要写死 Python 路径：本机 Python 是后装的，
    在安装之前打开的终端里 PATH 是旧快照，`python` 会落到 WindowsApps 存根上。
#>
$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$python = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'
if (-not (Test-Path $python)) { $python = 'python' }

Write-Host "[0/3] 使用 Python: $python"
& $python -V
if ($LASTEXITCODE -ne 0) {
    Write-Host '[错误] 未找到可用的 Python 3.12。安装命令：' -ForegroundColor Red
    Write-Host '  winget install --id Python.Python.3.12 --exact --scope user'
    exit 1
}

$backend = Join-Path $root 'backend'
$venvDir = Join-Path $backend 'venv'
$venvPy = Join-Path $venvDir 'Scripts\python.exe'

if (-not (Test-Path $venvPy)) {
    Write-Host '[1/3] 创建 venv ...'
    & $python -m venv $venvDir
    if ($LASTEXITCODE -ne 0) { Write-Host '[错误] 创建 venv 失败' -ForegroundColor Red; exit 1 }
}
else {
    Write-Host '[1/3] venv 已存在，跳过创建'
}

Write-Host '[2/3] 升级 pip ...'
& $venvPy -m pip install --upgrade pip

Write-Host '[3/3] 安装 requirements.txt ...'
& $venvPy -m pip install -r (Join-Path $backend 'requirements.txt')
if ($LASTEXITCODE -ne 0) { Write-Host '[错误] 依赖安装失败' -ForegroundColor Red; exit 1 }

Write-Host ''
Write-Host '完成。下一步运行：.\dev-backend.ps1' -ForegroundColor Green
