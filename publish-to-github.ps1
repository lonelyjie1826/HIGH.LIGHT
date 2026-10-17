$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")

$changes = git status --porcelain
$unpushed = @(git log --oneline "origin/main..HEAD")

if ((-not $changes) -and ($unpushed.Count -eq 0)) {
  Write-Host ""
  Write-Host "No new changes found." -ForegroundColor Green
  Write-Host "The website is already up to date."
  exit 0
}

if ($changes) {
  Write-Host ""
  Write-Host "These files will be published:" -ForegroundColor Yellow
  Write-Host $changes
  Write-Host ""
}
else {
  Write-Host ""
  Write-Host "These commits have not been pushed to GitHub yet:" -ForegroundColor Yellow
  Write-Host $unpushed
  Write-Host ""
}

$answer = Read-Host "Publish to GitHub now? Type Y to continue"
if ($answer -notmatch "^[Yy]$") {
  Write-Host "Cancelled. GitHub was not changed." -ForegroundColor DarkGray
  exit 0
}

if ($changes) {
  git add -A
  $message = "Update website $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
  git commit -m $message
}

Write-Host ""
Write-Host "Pushing to GitHub..." -ForegroundColor Cyan
git push origin main

if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "PUSH FAILED - GitHub was NOT updated." -ForegroundColor Red
  Write-Host "Your commit is saved on this computer only." -ForegroundColor Red
  Write-Host "Read the git error message above, fix it, then run this script again." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "Publish complete." -ForegroundColor Green
Write-Host "GitHub will update the public website in 1-3 minutes."
