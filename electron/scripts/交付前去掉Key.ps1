# 去掉「免安装文件夹」里的 API Key（配合压缩成 zip 发给别人）
#
# 用途：`backend\.env` 会随包带进去（含你的 DEEPSEEK_API_KEY）。要把**免安装文件夹**打包发给别人时，
#       先跑这个脚本清掉它（不动仓库里的 backend\.env）。
#
# ⚠️ 只对免安装文件夹（win-unpacked）有效：
#    安装包（AI就业助手-安装版-x.y.z.exe）是**打包那一刻**把后端文件嵌进去的，
#    事后改 win-unpacked 里的 .env **不会**改变已生成的安装包。
#    要发**不含 Key 的安装包** → 用 electron\scripts\打可交付包.ps1（它清了 Key 再重打）。
#
# 用法（仓库根目录）：
#     powershell -ExecutionPolicy Bypass -File electron\scripts\交付前去掉Key.ps1
#     powershell -ExecutionPolicy Bypass -File electron\scripts\交付前去掉Key.ps1 -Package "electron\release\win-unpacked"
#
# 清掉之后 AI 功能会走 7.6 兜底话术（不崩、但对话/润色/复盘质量下降）——
# 想让评委看到完整 AI 效果，就得放一个 Key（建议用限额 Key，别用你自己的主 Key）。

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
