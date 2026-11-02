param(
    [string]$Version = "2.1.0",
    [string]$GoExe = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

if (-not $GoExe) {
    if (Test-Path ".tools\go\bin\go.exe") {
        $GoExe = (Resolve-Path ".tools\go\bin\go.exe").Path
    } else {
        $command = Get-Command go.exe -ErrorAction SilentlyContinue
        if (-not $command) { throw "Go not found. Install Go 1.20+ or pass -GoExe." }
        $GoExe = $command.Source
    }
}

$BuildTime = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
$env:CGO_ENABLED = "0"
$env:GOFLAGS = "-buildvcs=false"

New-Item -ItemType Directory -Force dist | Out-Null

Push-Location app
$env:GOOS = "linux"
$env:GOARCH = "amd64"
& $GoExe build -trimpath -ldflags "-s -w -X main.version=$Version -X main.buildTime=$BuildTime" -o ..\dist\qrbridge-linux-amd64 .
if ($LASTEXITCODE -ne 0) { throw "Linux build failed" }

$env:GOOS = "windows"
$env:GOARCH = "amd64"
& $GoExe build -trimpath -ldflags "-s -w -H windowsgui -X main.version=$Version -X main.buildTime=$BuildTime" -o ..\dist\QRBridge.exe .
if ($LASTEXITCODE -ne 0) { throw "Windows build failed" }
Pop-Location

Remove-Item Env:GOOS -ErrorAction SilentlyContinue
Remove-Item Env:GOARCH -ErrorAction SilentlyContinue

python packaging\build_deb.py --binary dist\qrbridge-linux-amd64 --version $Version
if ($LASTEXITCODE -ne 0) { throw "Debian package build failed" }

python packaging\build_python_portable.py --version $Version
if ($LASTEXITCODE -ne 0) { throw "Python compatibility package build failed" }

python packaging\build_archives.py --version $Version
if ($LASTEXITCODE -ne 0) { throw "Archive build failed" }

Write-Host ""
Write-Host "Build complete: $Root\dist"
Get-ChildItem dist -File | Sort-Object Name | Select-Object Name, Length | Format-Table -AutoSize
