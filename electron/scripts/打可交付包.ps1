# 一键打出「可以发给别人」的包：清掉 API Key → 重打后端 → 重打桌面端 → 还原你的 Key
#
# 为什么需要它：安装包（AI就业助手-安装版-x.y.z.exe）是**打包那一刻**把内置后端
# （含 backend\.env 里的 DEEPSEEK_API_KEY）嵌进去的。要想发出去的安装包**不含 Key**，
# 必须"先清 Key 再重打"，事后改文件是没用的。
#
# 用法（仓库根目录，约 3~5 分钟）：
#     powershell -ExecutionPolicy Bypass -File electron\scripts\打可交付包.ps1
#
# 它会：
#   1. 备份 backend\.env，把 DEEPSEEK_API_KEY 的值清空；
#   2. 重打内置后端（backend\build_backend.ps1）；
#   3. 重打桌面端（electron\npm run dist → 免安装版 + 安装版）；
#   4. **还原** backend\.env（你本机继续能正常用 AI）；
#   5. 校验产物里的 .env 确实没有 sk- 开头的串。
#
# 产物（在 electron\release\ 下）：
#   - AI就业助手-安装版-x.y.z.exe   ← 单文件，发给别人最省事
#   - win-unpacked\                 ← 免安装文件夹，想发 zip 就压这个

param(
    [switch]$KeepKey  # 加 -KeepKey 就带着 Key 打（自己演示用），跳过第 1、4 步
)

$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$envPath = Join-Path $repo "backend\.env"

if (-not (Test-Path $envPath)) { throw "找不到 $envPath" }

$original = [System.IO.File]::ReadAllText($envPath, (New-Object System.Text.UTF8Encoding($false)))
$stripped = [regex]::Replace($original, '(?m)^(\s*DEEPSEEK_API_KEY\s*=).*$', '$1')

try {
    if ($KeepKey) {
        Write-Host "[1/5] -KeepKey：保留 Key，跳过清理。" -ForegroundColor Yellow
    } else {
        Write-Host "[1/5] 清空 backend\.env 里的 DEEPSEEK_API_KEY（原文件已备份在内存里）…"
        [System.IO.File]::WriteAllText($envPath, $stripped, (New-Object System.Text.UTF8Encoding($false)))
    }

    Write-Host "[2/5] 重打内置后端…"
    powershell -ExecutionPolicy Bypass -File (Join-Path $repo "backend\build_backend.ps1")

    Write-Host "[3/5] 重打桌面端（免安装版 + 安装版）…"
    Push-Location (Join-Path $repo "electron")
    try {
        & npm run dist
    }
    finally {
        Pop-Location
    }
}
finally {
    if (-not $KeepKey) {
        Write-Host "[4/5] 还原 backend\.env（你的 Key 回来了）…"
        [System.IO.File]::WriteAllText($envPath, $original, (New-Object System.Text.UTF8Encoding($false)))
    } else {
        Write-Host "[4/5] -KeepKey：无需还原。"
    }
}

Write-Host "[5/5] 校验产物…"
$packed = Join-Path $repo "electron\release\win-unpacked\resources\backend\.env"
if (-not (Test-Path $packed)) { throw "找不到产物里的 .env：$packed（打包失败？）" }
$packedText = [System.IO.File]::ReadAllText($packed, (New-Object System.Text.UTF8Encoding($false)))
if ($packedText -match "sk-[A-Za-z0-9]") {
    Write-Host "  ⚠️ 产物里仍然有 Key！请检查 backend\.env 是否被别处覆盖。" -ForegroundColor Red
} else {
    Write-Host "  ✓ 产物 .env 里没有 Key" -ForegroundColor Green
}

# 安装包是把同样内容嵌进去的：直接按字节搜一遍，确认没有 sk- 开头的 Key 残留
$setup = Get-ChildItem (Join-Path $repo "electron\release") -Filter "*安装版*.exe" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($setup) {
    $bytes = [System.IO.File]::ReadAllBytes($setup.FullName)
    $needle = [System.Text.Encoding]::ASCII.GetBytes("sk-")
    $found = $false
    for ($i = 0; $i -lt ($bytes.Length - $needle.Length); $i++) {
        if ($bytes[$i] -eq $needle[0] -and $bytes[$i + 1] -eq $needle[1] -and $bytes[$i + 2] -eq $needle[2]) {
            $found = $true
            break
        }
    }
    if ($found) {
        Write-Host ("  ⚠️ {0} 里仍能搜到 sk-，别发出去！" -f $setup.Name) -ForegroundColor Red
    } else {
        Write-Host ("  ✓ {0}（{1} MB）里搜不到 sk-，可以发" -f $setup.Name, [math]::Round($setup.Length / 1MB, 1)) -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "要发给别人的东西："
Write-Host "  · electron\release\AI就业助手-安装版-*.exe   （单文件，对方双击安装）"
Write-Host "  · 或把 electron\release\win-unpacked\ 压成 zip（对方解压即用，不需要装）"
Write-Host ""
Write-Host "提醒：对方机器上 AI 能不能用，取决于包里有没有 Key。"
Write-Host "      -KeepKey 打出来的包 AI 全功能，但会用**你的**额度、且 Key 可被提取。"
