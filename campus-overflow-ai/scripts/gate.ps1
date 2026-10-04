# PowerShell 包装：日常调用 gate.sh（机器 bash 指向 WSL，需用 Git 自带 bash 执行）
$bashExe = "C:\Program Files\Git\bin\bash.exe"
if (-not (Test-Path $bashExe)) { $bashExe = (Get-Command git).Source -replace 'git\.exe$', 'bash.exe' }
& $bashExe (Join-Path $PSScriptRoot 'gate.sh') @args
exit $LASTEXITCODE
