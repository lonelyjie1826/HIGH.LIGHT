$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")

$changes = git status --porcelain
if (-not $changes) {
  Write-Host ""
  Write-Host "没有需要发布的新内容。" -ForegroundColor Green
  Write-Host "网站已经是最新版本。"
  exit 0
}

Write-Host ""
Write-Host "即将发布以下文件：" -ForegroundColor Yellow
Write-Host $changes
Write-Host ""

$answer = Read-Host "确认发布到 GitHub？输入 Y 继续"
if ($answer -notmatch "^[Yy]$") {
  Write-Host "已取消，没有修改 GitHub。" -ForegroundColor DarkGray
  exit 0
}

git add -A
$message = "Update website $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
git commit -m $message
git push origin main

Write-Host ""
Write-Host "发布完成。" -ForegroundColor Green
Write-Host "GitHub 会在 1-3 分钟内自动更新公开网站。"
