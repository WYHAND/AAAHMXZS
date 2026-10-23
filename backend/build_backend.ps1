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
    # ⚠️ 只把「运行时真正要读的数据目录」逐个当数据带上，**不要**用
    #    `--add-data "app;app"`：那会在磁盘上多出一份 app\main.py，导入时可能与
    #    冻结模块打架，而且 PyInstaller 静态分析看不到 uvicorn 的字符串动态导入
    #    （run_server.py 里已改成 `from app.main import app` 直接导入）。
    #
    # ⚠️ 为什么下面这几个目录**必须**显式 --add-data：
    #    PyInstaller 的静态分析只跟 `import`（.py/.pyd），看不见 .txt / .json；
    #    而这几处都是**运行时按 `Path(__file__)` 相对定位**去读纯数据文件：
    #      1) app/ai/prompts          ← ai/parser.py
    #           PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"（*.txt）
    #      2) app/ai/question_bank    ← services/question_bank_service.py
    #           BANK_DIR = Path(__file__).resolve().parent.parent / "ai" / "question_bank"
    #           （题库 *.json；漏了 → 模拟面试出题 500 / 无候选题）
    #      3) app/ai/career_content   ← services/career_content_service.py
    #           CONTENT_DIR = Path(__file__).resolve().parent.parent / "ai" / "career_content"
    #           （就业素材 *.json；漏了 → 对话讲就业那一块 500 / 无素材）
    #    加漏了在开发机上照样能跑（源文件就在旁边），只有**干净机器**上才炸，
    #    所以以后在 app/ai/ 下新增数据目录（关键词表、语料等）必须同步在这里加一行。
    #    「源;目标」两侧都用正斜杠，目标路径与源码树保持一致；冻结后 PyInstaller
    #    把它落到 `_internal/app/ai/...`，正好与上面那些 Path(__file__) 对齐。
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
        --add-data "app/ai/question_bank;app/ai/question_bank" `
        --add-data "app/ai/career_content;app/ai/career_content" `
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
