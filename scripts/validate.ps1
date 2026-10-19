<#
.SYNOPSIS
  Validates every plugin in plugins/ and the marketplace file.

.DESCRIPTION
  For each folder under plugins/ that holds .claude-plugin/plugin.json:
    - claude plugin validate <folder>
    - claude plugin test <folder>   (only when the folder holds *.test.ts files)
  Then checks that every plugin folder is listed in marketplace.json and that
  every marketplace entry points at an existing folder.
  Exits with code 1 when anything fails.

.EXAMPLE
  .\scripts\validate.ps1
  .\scripts\validate.ps1 -Only delete-guard
#>
[CmdletBinding()]
param(
  [string]$Only
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$pluginsDir = Join-Path $root 'plugins'
$marketplaceFile = Join-Path $root '.claude-plugin\marketplace.json'
$failed = 0

function Step([string]$label, [scriptblock]$body) {
  Write-Host "==> $label" -ForegroundColor Cyan
  & $body
  if ($LASTEXITCODE -ne 0) {
    Write-Host "    FAILED ($label)" -ForegroundColor Red
    $script:failed++
  }
}

# 1. Marketplace file itself
Step 'marketplace: claude plugin validate .' { claude plugin validate $root }

$marketplace = Get-Content $marketplaceFile -Raw | ConvertFrom-Json
$listed = @{}
foreach ($entry in $marketplace.plugins) {
  $listed[$entry.name] = $entry.source
  $target = Join-Path $root ($entry.source -replace '^\./', '')
  if (-not (Test-Path (Join-Path $target '.claude-plugin\plugin.json'))) {
    Write-Host "marketplace entry '$($entry.name)' points at '$($entry.source)' but no plugin.json is there" -ForegroundColor Red
    $failed++
  }
}

# 2. Each plugin folder
$folders = Get-ChildItem $pluginsDir -Directory -ErrorAction SilentlyContinue |
  Where-Object { Test-Path (Join-Path $_.FullName '.claude-plugin\plugin.json') }
if ($Only) { $folders = $folders | Where-Object { $_.Name -eq $Only } }

if (-not $folders) {
  Write-Host 'No plugins found under plugins/ (nothing to validate yet).' -ForegroundColor Yellow
}

foreach ($f in $folders) {
  $manifest = Get-Content (Join-Path $f.FullName '.claude-plugin\plugin.json') -Raw | ConvertFrom-Json
  if ($manifest.name -ne $f.Name) {
    Write-Host "plugin folder '$($f.Name)' has manifest name '$($manifest.name)'; they must match" -ForegroundColor Red
    $failed++
  }
  if (-not $listed.ContainsKey($f.Name)) {
    Write-Host "plugin '$($f.Name)' is not listed in marketplace.json" -ForegroundColor Red
    $failed++
  }

  Step "$($f.Name): claude plugin validate" { claude plugin validate $f.FullName }

  $hasTests = Get-ChildItem $f.FullName -Recurse -Filter '*.test.ts' -ErrorAction SilentlyContinue
  if ($hasTests) {
    Step "$($f.Name): claude plugin test" { claude plugin test $f.FullName }
  }
}

if ($failed -gt 0) {
  Write-Host "`n$failed check(s) failed." -ForegroundColor Red
  exit 1
}
Write-Host "`nAll checks passed." -ForegroundColor Green
exit 0
