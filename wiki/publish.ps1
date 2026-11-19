# Publish local wiki/ content to the GitHub Wiki repository.
# Prerequisite: enable Settings > Features > Wikis and create the Home page first.
param(
    [string]$WikiUrl = "https://github.com/hbuas-se-2026fall/cs2411-team06-campus-overflow.wiki.git",
    [string]$Message = "docs: update project wiki"
)

$ErrorActionPreference = "Stop"
$source = $PSScriptRoot
$temp = Join-Path $env:TEMP ("campus-overflow-wiki-" + [guid]::NewGuid().ToString("N"))

git clone --depth 1 $WikiUrl $temp
if ($LASTEXITCODE -ne 0) {
    throw "Cannot clone wiki repo. Enable Wikis and create the Home page first."
}

Get-ChildItem -Path $source -Filter *.md | Copy-Item -Destination $temp -Force
Copy-Item -Path (Join-Path $source "assets") -Destination $temp -Recurse -Force

git -C $temp add -A
git -C $temp commit -m $Message
git -C $temp push
Write-Output "Wiki pushed: $WikiUrl"
