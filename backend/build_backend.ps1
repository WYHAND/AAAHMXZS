# 把后端打成"免安装 exe 目录"，供 Electron 随包带走（electron-builder.yml 的 extraResources 会取它）
#
# 用法（在仓库根目录）：
#     powershell -ExecutionPolicy Bypass -File backend\build_backend.ps1
#
# 产物：backend\dist\aicareer-backend\
#     ├── aicareer-backend.exe     ← 后端本体（Electron 主进程 spawn 它）
#     ├── .env                     ← ⚠️ 必须在 exe **同级**（见下面的说明）
#     ├── data\app.db              ← 用户数据（首次启动自动建表+灌种子）
#     └── _internal\               ← Python 运行时与依赖
#
# ⚠️ 为什么要把 .env 放在 exe 同级（而不是让 PyInstaller 用 --add-data 塞进 _internal）：
#   1. 后端的配置是 **cwd 相对**读取 `.env` 的（勘误 9.14），而 Electron spawn 时把 cwd
#      设成这个目录 —— 放进 `_internal\` 的话 cwd 就找不到它，DEEPSEEK_API_KEY 为空、
#      AI 全线走兜底话术；
#   2. `.env` 里有 API Key，**只该存在一份**，两份容易漏改、也容易在交付时忘了清。

$ErrorActionPreference = "Stop"
$backendDir = $PSScriptRoot

Push-Location $backendDir
try {
    Write-Host "[1/3] 清理上次产物…"
    Remove-Item -Recurse -Force build, dist -ErrorAction SilentlyContinue
    Remove-Item -Force aicareer-backend.spec -ErrorAction SilentlyContinue

    Write-Host "[2/3] PyInstaller 打包（1~3 分钟）…"
    # ⚠️ 只把 prompts 当数据带上，**不要**用 `--add-data "app;app"`：
    #    那会在磁盘上多出一份 app\main.py，导入时可能与冻结模块打架，
    #    而且 PyInstaller 静态分析看不到 uvicorn 的字符串动态导入
    #    （run_server.py 里已改成 `from app.main import app` 直接导入）。
    #    prompt 是 .txt，静态分析看不见，必须显式带上；位置要与
    #    app/ai/parser.py 的 `PROMPTS_DIR = Path(__file__).parent / "prompts"` 对齐。
    $iconArg = @()
    $iconPath = Join-Path $backendDir "..\electron\build\icon.ico"
    if (Test-Path $iconPath) { $iconArg = @("--icon", $iconPath) }

    & ".\venv\Scripts\pyinstaller.exe" --noconfirm --clean `
        --name aicareer-backend --onedir `
        --collect-all fastapi `
        --collect-all uvicorn `
        --collect-all apscheduler `
        --collect-all sqlmodel `
        --collect-all passlib `
        --collect-all jose `
        --add-data "app/ai/prompts;app/ai/prompts" `
        @iconArg `
        run_server.py

    if (-not (Test-Path "dist\aicareer-backend\aicareer-backend.exe")) {
        throw "打包失败：没有生成 dist\aicareer-backend\aicareer-backend.exe"
    }

    Write-Host "[3/3] 把 .env 放到 exe 同级（cwd 相对读取）…"
    Copy-Item ".env" "dist\aicareer-backend\.env" -Force

    $size = [math]::Round(((Get-ChildItem "dist\aicareer-backend" -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 1)
    Write-Host ""
    Write-Host "完成：backend\dist\aicareer-backend\  （$size MB）"
    Write-Host "提示：这个目录会被 electron-builder 复制到安装包的 resources\backend\ 下。"
}
finally {
    Pop-Location
}
