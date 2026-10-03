# 交付前一键去掉 API Key
#
# 用途：打包产物里带着 backend/.env（含你的 DEEPSEEK_API_KEY）。要交给评委 / 上传 / 发给别人之前，
#       跑一次这个脚本，把 Key 从**已打包好的产物**里清掉（不动仓库里的 backend/.env）。
#
# 用法（仓库根目录）：
#     powershell -ExecutionPolicy Bypass -File electron\scripts\交付前去掉Key.ps1
#     powershell -ExecutionPolicy Bypass -File electron\scripts\交付前去掉Key.ps1 -Package "electron\release\win-unpacked"
#
# 清掉之后 AI 功能会走 7.6 兜底话术（不崩、但对话/润色/复盘质量下降）——
# 想让评委看到完整 AI 效果，就别清；想安全交付，就先清。

param(
    [string]$Package = "electron\release\win-unpacked"
)

$ErrorActionPreference = "Stop"

$envFile = Join-Path $Package "resources\backend\.env"
if (-not (Test-Path $envFile)) {
    throw "找不到 $envFile —— 请先完成打包（electron\release\win-unpacked 应已存在）"
}

Write-Host "目标：$envFile"

$content = [System.IO.File]::ReadAllText($envFile, (New-Object System.Text.UTF8Encoding($false)))

# 把等号后面的值清空（保留键名，程序仍能正常启动，只是提示"未配置"）
$pattern = '(?m)^(\s*DEEPSEEK_API_KEY\s*=).*$'
if ($content -notmatch $pattern) {
    Write-Host "没找到 DEEPSEEK_API_KEY 这一行，可能已经清过了。"
} else {
    $new = [regex]::Replace($content, $pattern, '$1')
    [System.IO.File]::WriteAllText($envFile, $new, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "已清空 DEEPSEEK_API_KEY 的值。"
}

Write-Host ""
Write-Host "复核（应看不到 sk- 开头的串）："
$left = Select-String -Path $envFile -Pattern "sk-" -SimpleMatch -ErrorAction SilentlyContinue
if ($left) {
    Write-Host "  ⚠️ 仍发现疑似 Key：" $left.Line
    exit 1
} else {
    Write-Host "  ✓ 产物里的 .env 已不含 Key"
}

Write-Host ""
Write-Host "提醒：仓库里的 backend\.env 没有被改动（那是你自己开发用的）；"
Write-Host "      如果你也想清掉它，手动编辑即可 —— 但下次本机演示 AI 就用不了完整效果了。"
