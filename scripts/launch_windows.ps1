$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root "src-tauri\target\release\hobo.exe"

if (-not (Test-Path $exe)) {
    throw "Hobo has not been built yet: $exe"
}

$existing = Get-Process -Name "hobo" -ErrorAction SilentlyContinue
if ($existing) {
    $existing | Select-Object Id, ProcessName, MainWindowTitle, Responding | Format-List
    exit 0
}

$process = Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -PassThru
Start-Sleep -Seconds 6
$process.Refresh()

if ($process.HasExited) {
    throw "Hobo exited with code $($process.ExitCode)"
}

Get-Process -Id $process.Id | Select-Object Id, ProcessName, MainWindowTitle, Responding | Format-List
