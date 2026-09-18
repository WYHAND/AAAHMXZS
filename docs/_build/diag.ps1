param([Parameter(Mandatory = $true)][string]$Docx)

# ASCII-only diagnostics: dump line-break chars of paragraph 2 and all outline level 1-2 paragraphs.

$ErrorActionPreference = 'Stop'
$path = (Resolve-Path -LiteralPath $Docx).Path

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$doc = $null
try {
  $doc = $word.Documents.Open($path, $false, $true)

  $p2 = $doc.Paragraphs.Item(2).Range.Text
  Write-Host "--- paragraph 2 raw ---"
  $codes = @()
  foreach ($ch in $p2.ToCharArray()) {
    $c = [int][char]$ch
    $codes += ("{0}({1})" -f $(if ($c -lt 32) { 'CTRL' } else { $ch }), $c)
  }
  Write-Host ($codes -join ' ')
  Write-Host "has vertical-tab(11): $($p2.Contains([char]11))"

  Write-Host "--- outline levels 1-2 ---"
  $n = 0
  for ($k = 1; $k -le $doc.Paragraphs.Count; $k++) {
    $p = $doc.Paragraphs.Item($k)
    if ($p.OutlineLevel -le 2) {
      $n++
      $t = $p.Range.Text -replace "[`r`n`a`t`v]", ' '
      if ($t.Length -gt 40) { $t = $t.Substring(0, 40) }
      Write-Host ("  #{0} [{1}] lvl={2} :: {3}" -f $n, $k, $p.OutlineLevel, $t)
    }
  }
}
finally {
  if ($doc) { $doc.Close(0) | Out-Null }
  $word.Quit() | Out-Null
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
  [GC]::Collect()
}
