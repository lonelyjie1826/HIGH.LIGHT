$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")

$changes = git status --porcelain

# 本地已经提交、但还没推送到 GitHub 的 commit
# （例如上一次 git push 失败或中途关掉了窗口）
$unpushed = @(git log --oneline "origin/main..HEAD")

if (-not $changes) {
  if ($unpushed.Count -eq 0) {
    Write-Host ""
    Write-Host "No new changes found." -ForegroundColor Green
    Write-Host "The website is already up to date."
    exit 0
  }

  Write-Host ""
  Write-Host "These commits have not been pushed to GitHub yet:" -ForegroundColor Yellow
  Write-Host ($unpushed -join "`n")
  Write-Host ""

  $retry = Read-Host "Push them now? Type Y to continue"
  if ($retry -notmatch "^[Yy]$") {
    Write-Host "Cancelled. GitHub was not changed." -ForegroundColor DarkGray
    exit 0
  }

  git push origin main

  Write-Host ""
  Write-Host "Publish complete." -ForegroundColor Green
  Write-Host "GitHub will update the public website in 1-3 minutes."
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
