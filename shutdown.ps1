<#
    shutdown.ps1 —— Windows 关机 / 重启 / 休眠 / 锁屏 小工具（交互式 + 命令行参数）

    交互式用法：
        .\shutdown.ps1

    命令行用法（适合写进任务计划或别的脚本里）：
        .\shutdown.ps1 -Action shutdown -Delay 3600        # 1 小时后关机
        .\shutdown.ps1 -Action restart  -At 23:30          # 23:30 重启（若已过点则次日）
        .\shutdown.ps1 -Action shutdown -Delay 600 -Yes    # 10 分钟后关机，跳过确认
        .\shutdown.ps1 -Action cancel                      # 取消已排定的关机/重启
        .\shutdown.ps1 -Action lock                        # 锁屏
        .\shutdown.ps1 -Action info                        # 查看开机时间 / 运行时长

    若被执行策略拦住，可这样运行：
        powershell -NoProfile -ExecutionPolicy Bypass -File .\shutdown.ps1

    ⚠️ 本文件必须保存为 UTF-8 **with BOM**：Windows PowerShell 5.1 读无 BOM 的 .ps1 会
    按 ANSI(GBK) 解析，中文会乱码甚至语法报错；用「局部替换」类工具改完请确认前三字节
    仍是 EF BB BF（与本仓库其它 *.ps1 保持一致）。
#>

[CmdletBinding()]
param(
    [ValidateSet('shutdown', 'restart', 'sleep', 'hibernate', 'lock', 'cancel', 'info')]
    [string]$Action,

    # 多少秒后执行，默认 60 秒
    [int]$Delay = 60,

    # 指定执行时刻（24 小时制 HH:mm），优先级高于 -Delay
    [string]$At,

    # 跳过交互确认（用于脚本 / 任务计划）
    [switch]$Yes,

    # 强制结束未响应的程序（对应 shutdown.exe 的 /f）
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

# ---------- 输出小工具 ----------

function Write-Line {
    param([string]$Text, [string]$Color = 'Gray')
    Write-Host $Text -ForegroundColor $Color
}

function Confirm-Step {
    # -Yes 时不再询问；否则要求明确输入 y / yes / 是
    param([string]$Question)
    if ($Yes) { return $true }
    $answer = Read-Host "$Question [y/N]"
    return [bool]($answer -match '^(y|yes|是)$')
}

function Format-Duration {
    param([TimeSpan]$Span)
    $parts = @()
    if ($Span.Days)    { $parts += "$($Span.Days) 天" }
    if ($Span.Hours)   { $parts += "$($Span.Hours) 小时" }
    if ($Span.Minutes) { $parts += "$($Span.Minutes) 分钟" }
    if (-not $parts)   { $parts += "$($Span.Seconds) 秒" }
    return ($parts -join ' ')
}

function Resolve-WhenSeconds {
    # -At 优先；否则用 -Delay；返回需要等待的秒数
    if (-not $At) { return [Math]::Max(0, $Delay) }

    try {
        $parsed = [datetime]::ParseExact($At.Trim(), 'HH:mm', [Globalization.CultureInfo]::InvariantCulture)
    }
    catch {
        throw "无法解析 -At '$At'，请用 24 小时制 HH:mm，例如 -At 23:30"
    }

    $now = Get-Date
    $target = $now.Date.AddHours($parsed.Hour).AddMinutes($parsed.Minute)
    if ($target -le $now) { $target = $target.AddDays(1) }   # 已过点 → 次日
    return [int][Math]::Ceiling(($target - $now).TotalSeconds)
}

# ---------- 具体动作 ----------

function Invoke-SystemShutdown {
    param(
        [ValidateSet('shutdown', 'restart')] [string]$Kind,
        [int]$Seconds,
        [switch]$ForceClose
    )

    $cmdArgs = @(if ($Kind -eq 'shutdown') { '/s' } else { '/r' })
    $cmdArgs += @('/t', "$Seconds")

    # 说明：shutdown.exe 只在 /t > 0 时才隐含 /f；/t 0（立即）需要显式 /f 才会
    # 真正关掉「有程序未保存」的阻止弹窗，否则可能卡住不动。
    if ($ForceClose -or $Seconds -le 0) { $cmdArgs += '/f' }

    if ($Seconds -gt 0) {
        $verb = if ($Kind -eq 'shutdown') { '关机' } else { '重启' }
        $cmdArgs += @('/c', "系统将在 $Seconds 秒后$verb，取消请执行 shutdown /a")
    }

    Write-Line ("执行：shutdown.exe " + ($cmdArgs -join ' ')) 'DarkGray'
    & shutdown.exe @cmdArgs
    if ($LASTEXITCODE -ne 0) { throw "shutdown.exe 返回错误码 $LASTEXITCODE" }
}

function Invoke-Suspend {
    param([ValidateSet('sleep', 'hibernate')] [string]$Mode)

    # 需要 WinForms（Windows PowerShell 5.1 自带；PowerShell 7 需装 Desktop 运行时）
    Add-Type -AssemblyName System.Windows.Forms

    # 注意：Sleep 与 Hibernate 的实际行为受电源策略影响，系统启用休眠时
    # Suspend 也可能进入休眠（S4）而非睡眠（S3）。
    $state = if ($Mode -eq 'sleep') {
        [System.Windows.Forms.PowerState]::Suspend
    }
    else {
        [System.Windows.Forms.PowerState]::Hibernate
    }
    [System.Windows.Forms.Application]::SetSuspendState($state, $false, $false)
}

function Invoke-Dispatch {
    param([string]$Kind)

    switch ($Kind) {
        'shutdown' {
            $s = Resolve-WhenSeconds
            $when = if ($s -le 0) { '立即' } else { "在 $(Format-Duration ([TimeSpan]::FromSeconds($s)))后" }
            if (-not (Confirm-Step "确认要$when关机吗？（未保存的工作可能丢失，请先保存）")) {
                Write-Line '已取消。' 'Yellow'; return
            }
            Invoke-SystemShutdown -Kind shutdown -Seconds $s -ForceClose:$Force
            if ($s -gt 0) {
                Write-Line "已排定 $when关机；取消请执行：.\shutdown.ps1 -Action cancel" 'Green'
            }
        }
        'restart' {
            $s = Resolve-WhenSeconds
            $when = if ($s -le 0) { '立即' } else { "在 $(Format-Duration ([TimeSpan]::FromSeconds($s)))后" }
            if (-not (Confirm-Step "确认要$when重启吗？（未保存的工作可能丢失，请先保存）")) {
                Write-Line '已取消。' 'Yellow'; return
            }
            Invoke-SystemShutdown -Kind restart -Seconds $s -ForceClose:$Force
            if ($s -gt 0) {
                Write-Line "已排定 $when重启；取消请执行：.\shutdown.ps1 -Action cancel" 'Green'
            }
        }
        'sleep' {
            if (-not (Confirm-Step '确认要让电脑睡眠吗？')) { Write-Line '已取消。' 'Yellow'; return }
            Invoke-Suspend -Mode sleep
        }
        'hibernate' {
            if (-not (Confirm-Step '确认要让电脑休眠吗？')) { Write-Line '已取消。' 'Yellow'; return }
            Invoke-Suspend -Mode hibernate
        }
        'lock' {
            & rundll32.exe user32.dll,LockWorkStation
            Write-Line '已锁屏。' 'Green'
        }
        'cancel' {
            & shutdown.exe /a
            if ($LASTEXITCODE -ne 0) {
                Write-Line '没有可取消的关机 / 重启计划。' 'Yellow'
            }
            else {
                Write-Line '已取消排定的关机 / 重启。' 'Green'
            }
        }
        'info' {
            $os = Get-CimInstance -ClassName Win32_OperatingSystem
            $boot = $os.LastBootUpTime
            Write-Line ("开机时间：{0:yyyy-MM-dd HH:mm:ss}" -f $boot) 'White'
            Write-Line ("已运行  ：{0}" -f (Format-Duration ((Get-Date) - $boot))) 'White'
            Write-Line '取消已排定的关机： .\shutdown.ps1 -Action cancel' 'DarkGray'
        }
        default {
            throw "未知操作：$Kind"
        }
    }
}

# ---------- 交互式菜单 ----------

function Read-Minutes {
    param([int]$Default = 60)
    while ($true) {
        $raw = Read-Host "多少分钟后执行？(直接回车 = $Default 分钟)"
        if ([string]::IsNullOrWhiteSpace($raw)) { return $Default }
        $n = 0
        if ([int]::TryParse($raw, [ref]$n) -and $n -gt 0) { return $n }
        Write-Line '请输入一个正整数分钟数。' 'Yellow'
    }
}

function Show-Menu {
    while ($true) {
        Write-Host ''
        Write-Line '========== 电源操作 ==========' 'Cyan'
        Write-Line '  1) 定时关机'
        Write-Line '  2) 立即关机'
        Write-Line '  3) 定时重启'
        Write-Line '  4) 立即重启'
        Write-Line '  5) 休眠'
        Write-Line '  6) 睡眠'
        Write-Line '  7) 锁屏'
        Write-Line '  8) 取消已排定的关机 / 重启'
        Write-Line '  9) 系统信息'
        Write-Line '  0) 退出'
        Write-Line '==============================' 'Cyan'

        switch (Read-Host '请选择') {
            '1' {
                $script:At = $null
                $script:Delay = (Read-Minutes) * 60
                Invoke-Dispatch 'shutdown'
            }
            '2' {
                $script:At = $null
                $script:Delay = 0
                Invoke-Dispatch 'shutdown'
            }
            '3' {
                $script:At = $null
                $script:Delay = (Read-Minutes) * 60
                Invoke-Dispatch 'restart'
            }
            '4' {
                $script:At = $null
                $script:Delay = 0
                Invoke-Dispatch 'restart'
            }
            '5' { Invoke-Dispatch 'hibernate' }
            '6' { Invoke-Dispatch 'sleep' }
            '7' { Invoke-Dispatch 'lock' }
            '8' { Invoke-Dispatch 'cancel' }
            '9' { Invoke-Dispatch 'info' }
            '0' { return }
            default { Write-Line '无效选择，请重新输入。' 'Yellow' }
        }
    }
}

# ---------- 入口 ----------

try {
    if ($Action) { Invoke-Dispatch $Action }
    else { Show-Menu }
}
catch {
    Write-Line "[错误] $($_.Exception.Message)" 'Red'
    exit 1
}
