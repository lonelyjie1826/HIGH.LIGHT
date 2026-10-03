$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")

$changes = git status --porcelain
if (-not $changes) {
  Write-Host ""
  Write-Host "No new changes found." -ForegroundColor Green
  Write-Host "The website is already up to date."
  exit 0
}

Write-Host ""
Write-Host "These files will be published:" -ForegroundColor Yellow
Write-Host $changes
Write-Host ""

$answer = Read-Host "Publish to GitHub now? Type Y to continue"
if ($answer -notmatch "^[Yy]$") {
  Write-Host "Cancelled. GitHub was not changed." -ForegroundColor DarkGray
  exit 0
}

git add -A
$message = "Update website $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
git commit -m $message
git push origin main

Write-Host ""
Write-Host "Publish complete." -ForegroundColor Green
Write-Host "GitHub will update the public website in 1-3 minutes."
