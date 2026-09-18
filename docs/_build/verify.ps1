param(
  [Parameter(Mandatory = $true)][string]$Docx
)

# ASCII-only helper script. Reads back the generated .docx and reports structure.

$ErrorActionPreference = 'Stop'
$docxPath = (Resolve-Path -LiteralPath $Docx).Path

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$doc = $null
try {
  $doc = $word.Documents.Open($docxPath, $false, $true)
  Write-Host "file:       $docxPath"
  Write-Host "size:       $((Get-Item -LiteralPath $docxPath).Length) bytes"
  Write-Host "paragraphs: $($doc.Paragraphs.Count)"
  Write-Host "tables:     $($doc.Tables.Count)"
  Write-Host "sections:   $($doc.Sections.Count)"
  Write-Host "toc count:  $($doc.TablesOfContents.Count)"
  Write-Host "pages:      $($doc.ComputeStatistics(2))"
  Write-Host "words:      $($doc.ComputeStatistics(0))"

  $h = @{}
  for ($k = 1; $k -le $doc.Paragraphs.Count; $k++) {
    $lvl = $doc.Paragraphs.Item($k).OutlineLevel
    if ($lvl -ge 1 -and $lvl -le 6) {
      if (-not $h.ContainsKey($lvl)) { $h[$lvl] = 0 }
      $h[$lvl] = $h[$lvl] + 1
    }
  }
  Write-Host "heading counts:"
  foreach ($k in ($h.Keys | Sort-Object)) { Write-Host ("  outline {0}: {1}" -f $k, $h[$k]) }

  Write-Host "--- first 10 paragraphs ---"
  $limit = [Math]::Min(10, $doc.Paragraphs.Count)
  for ($k = 1; $k -le $limit; $k++) {
    $p = $doc.Paragraphs.Item($k)
    $t = $p.Range.Text -replace "[`r`n`a`t]", ' '
    if ($t.Length -gt 48) { $t = $t.Substring(0, 48) }
    Write-Host ("  [{0}] lvl={1} style='{2}' :: {3}" -f $k, $p.OutlineLevel, $p.Style.NameLocal, $t)
  }

  Write-Host "--- footer ---"
  foreach ($s in 1..$doc.Sections.Count) {
    $f = $doc.Sections.Item($s).Footers.Item(1)
    $ft = $f.Range.Text -replace "[`r`n`a`t`v]", ' '
    Write-Host ("  section {0}: fields={1} text='{2}'" -f $s, $f.Range.Fields.Count, $ft)
  }

  Write-Host "--- table 1 (first row) ---"  if ($doc.Tables.Count -ge 1) {
    $t1 = $doc.Tables.Item(1)
    Write-Host ("  rows={0} cols={1}" -f $t1.Rows.Count, $t1.Columns.Count)
    Write-Host ("  " + ($t1.Rows.Item(1).Range.Text -replace "[`r`n`a`t]", ' '))
    Write-Host ("  " + ($t1.Rows.Item(2).Range.Text -replace "[`r`n`a`t]", ' '))
  }

  Write-Host "--- last 3 paragraphs ---"
  $start = [Math]::Max(1, $doc.Paragraphs.Count - 2)
  for ($k = $start; $k -le $doc.Paragraphs.Count; $k++) {
    $t = $doc.Paragraphs.Item($k).Range.Text -replace "[`r`n`a`t]", ' '
    if ($t.Length -gt 60) { $t = $t.Substring(0, 60) }
    Write-Host ("  [{0}] {1}" -f $k, $t)
  }
}
finally {
  if ($doc) { $doc.Close(0) | Out-Null }
  $word.Quit() | Out-Null
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
  [GC]::Collect()
}
