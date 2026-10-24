param(
  [Parameter(Mandatory = $true)][string]$Docx
)
$ErrorActionPreference = 'Stop'
$path = (Resolve-Path -LiteralPath $Docx).Path
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$doc = $null
try {
  $doc = $word.Documents.Open($path, $false, $false)
  $n = 0
  foreach ($shape in $doc.InlineShapes) {
    try {
      $shape.LinkFormat.SavePictureWithDocument = -1
      $shape.LinkFormat.BreakLink()
      $n++
    }
    catch {
      Write-Host ("skip shape: " + $_.Exception.Message)
    }
  }
  $doc.Save()
  Write-Host "embedded attempts: $n / $($doc.InlineShapes.Count)"
}
finally {
  if ($doc) { $doc.Close(0) | Out-Null }
  $word.Quit() | Out-Null
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
  [GC]::Collect()
}
