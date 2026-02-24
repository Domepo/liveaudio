param(
  [int]$Limit = 300
)

$ErrorActionPreference = "Stop"

$targets = @(
  "apps/web/src"
)

$extensions = @(".svelte", ".ts", ".css")

$tooLong = @()
foreach ($target in $targets) {
  if (!(Test-Path $target)) { continue }
  Get-ChildItem -Recurse -File $target | Where-Object { $extensions -contains $_.Extension } | ForEach-Object {
    $lines = (Get-Content $_.FullName | Measure-Object -Line).Lines
    if ($lines -gt $Limit) {
      $tooLong += [pscustomobject]@{ Lines = $lines; File = $_.FullName }
    }
  }
}

if ($tooLong.Count -gt 0) {
  $tooLong | Sort-Object Lines -Descending | Format-Table -AutoSize | Out-String | Write-Host
  Write-Error "Line limit exceeded (>$Limit)."
  exit 1
}

Write-Host "OK: no files exceed $Limit lines."

