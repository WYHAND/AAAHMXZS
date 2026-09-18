param(
  [Parameter(Mandatory = $true)][string]$Html,
  [Parameter(Mandatory = $true)][string]$Docx,
  [string]$Title = ''
)

# NOTE: keep this file ASCII-only. Windows PowerShell reads .ps1 without BOM as ANSI,
# which corrupts non-ASCII literals and breaks parsing.

$ErrorActionPreference = 'Stop'

$htmlPath = (Resolve-Path -LiteralPath $Html).Path
$docxPath = [System.IO.Path]::GetFullPath((Join-Path (Get-Location).Path $Docx))
$docxDir = [System.IO.Path]::GetDirectoryName($docxPath)
if (-not (Test-Path -LiteralPath $docxDir)) { New-Item -ItemType Directory -Force -Path $docxDir | Out-Null }
if (Test-Path -LiteralPath $docxPath) { Remove-Item -LiteralPath $docxPath -Force }

function Find-FirstOutlineLevel {
  param($Document, [int]$Level)
  $count = $Document.Paragraphs.Count
  for ($k = 1; $k -le $count; $k++) {
    if ($Document.Paragraphs.Item($k).OutlineLevel -eq $Level) { return $k }
  }
  return -1
}

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0

$doc = $null
try {
  $doc = $word.Documents.Open($htmlPath, $false, $false)

  # Page setup: A4 with uniform margins
  $ps = $doc.PageSetup
  $ps.PageWidth = $word.CentimetersToPoints(21)
  $ps.PageHeight = $word.CentimetersToPoints(29.7)
  $ps.TopMargin = $word.CentimetersToPoints(2.2)
  $ps.BottomMargin = $word.CentimetersToPoints(2.2)
  $ps.LeftMargin = $word.CentimetersToPoints(2.0)
  $ps.RightMargin = $word.CentimetersToPoints(2.0)

  # Insert a table of contents before the first Heading 2 paragraph
  try {
    $idx = Find-FirstOutlineLevel -Document $doc -Level 2
    if ($idx -gt 0) {
      $r = $doc.Paragraphs.Item($idx).Range
      $r.Collapse(1) | Out-Null            # wdCollapseStart
      # TOC title: U+76EE U+5F55 ("mu lu"). Insert one paragraph mark only, so the
      # inserted title becomes paragraph idx and the chapter heading moves to idx+1.
      $tocTitle = [string][char]0x76EE + [string][char]0x5F55
      $r.InsertBefore($tocTitle + "`r") | Out-Null

      $p = $doc.Paragraphs.Item($idx)
      $p.Style = -1                        # wdStyleNormal
      $p.Range.Font.Size = 18
      $p.Range.Font.Bold = $true
      $p.Alignment = 1                     # centered
      $p.PageBreakBefore = $false
      $p.SpaceAfter = 14

      $idx2 = Find-FirstOutlineLevel -Document $doc -Level 2
      $r2 = $doc.Paragraphs.Item($idx2).Range
      $r2.Collapse(1) | Out-Null
      $toc = $doc.TablesOfContents.Add($r2, $true, 2, 3)   # levels 2-3, skip doc title
      $toc.Update() | Out-Null
      Write-Host "TOC: inserted before paragraph $idx2"
    }
    else {
      Write-Host "TOC: no Heading 2 found, skipped"
    }
  }
  catch {
    Write-Host "TOC: failed (skipped) -> $($_.Exception.Message)"
  }

  # Footer page numbers, centered, including first page
  try {
    $footer = $doc.Sections.Item(1).Footers.Item(1)
    $footer.Range.ParagraphFormat.Alignment = 1
    $footer.PageNumbers.Add(1, $true) | Out-Null
  }
  catch {
    Write-Host "PageNumbers: failed (skipped) -> $($_.Exception.Message)"
  }

  # Compact paragraphs a little so the manual does not blow up in page count
  $doc.Content.ParagraphFormat.SpaceAfter = 4
  $doc.Content.ParagraphFormat.SpaceBefore = 0

  if ($Title -ne '') { $doc.BuiltInDocumentProperties('Title') = $Title }

  $doc.SaveAs2($docxPath, 16)   # wdFormatDocumentDefault -> .docx

  Write-Host "paragraphs: $($doc.Paragraphs.Count)"
  Write-Host "tables:     $($doc.Tables.Count)"
  Write-Host "pages:      $($doc.ComputeStatistics(2))"
  Write-Host "saved:      $docxPath"
}
finally {
  if ($doc) { $doc.Close(0) | Out-Null }   # wdDoNotSaveChanges
  $word.Quit() | Out-Null
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
  [GC]::Collect()
}
