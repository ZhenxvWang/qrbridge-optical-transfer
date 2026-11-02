param(
    [string]$Jdk = "",
    [string]$Sdk = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Repo = Split-Path -Parent $Root
if (-not $Jdk) {
    $candidate = Get-ChildItem (Join-Path $Repo ".tools\jdk17") -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($candidate) { $Jdk = $candidate.FullName } else { $Jdk = Join-Path $Repo ".tools\jdk17" }
}
if (-not $Sdk) { $Sdk = Join-Path $Repo ".tools\android-sdk" }

$Javac = Join-Path $Jdk "bin\javac.exe"
$Jar = Join-Path $Jdk "bin\jar.exe"
$Keytool = Join-Path $Jdk "bin\keytool.exe"
if (-not (Test-Path $Javac)) { throw "javac not found: $Javac" }
$env:JAVA_HOME = $Jdk
$env:PATH = (Join-Path $Jdk "bin") + ";" + $env:PATH

$BuildTools = Join-Path $Sdk "build-tools\34.0.0"
$AndroidJar = Join-Path $Sdk "platforms\android-33\android.jar"
foreach ($tool in @("aapt2.exe", "d8.bat", "zipalign.exe", "apksigner.bat")) {
    if (-not (Test-Path (Join-Path $BuildTools $tool))) { throw "missing $tool under $BuildTools" }
}
if (-not (Test-Path $AndroidJar)) { throw "missing android.jar: $AndroidJar" }

$Work = Join-Path $Root "build"
$Classes = Join-Path $Work "classes"
$Dex = Join-Path $Work "dex"
$Gen = Join-Path $Work "gen"
$Unsigned = Join-Path $Work "unsigned.apk"
$Aligned = Join-Path $Work "aligned.apk"
$Output = Join-Path $Repo "dist\QRBridgeReceiver-2.0.12.apk"
Remove-Item $Work -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $Classes, $Dex, $Gen, (Split-Path $Output) | Out-Null

$javaFiles = Get-ChildItem (Join-Path $Root "app\src\main\java") -Recurse -Filter *.java | ForEach-Object { $_.FullName }
& $Javac -source 8 -target 8 -encoding UTF-8 -classpath $AndroidJar -d $Classes $javaFiles
if ($LASTEXITCODE -ne 0) { throw "javac failed" }

$classFiles = Get-ChildItem $Classes -Recurse -Filter *.class | ForEach-Object { $_.FullName }
& (Join-Path $BuildTools "d8.bat") --lib $AndroidJar --min-api 26 --output $Dex $classFiles
if ($LASTEXITCODE -ne 0) { throw "d8 failed" }

$ResZip = Join-Path $Work "resources.zip"
& (Join-Path $BuildTools "aapt2.exe") compile --dir (Join-Path $Root "app\src\main\res") -o $ResZip
if ($LASTEXITCODE -ne 0) { throw "aapt2 compile failed" }

& (Join-Path $BuildTools "aapt2.exe") link -o $Unsigned -I $AndroidJar `
    --manifest (Join-Path $Root "app\src\main\AndroidManifest.xml") --java $Gen $ResZip
if ($LASTEXITCODE -ne 0) { throw "aapt2 link failed" }

python (Join-Path $Root "add_assets.py") $Unsigned (Join-Path $Root "app\src\main\assets")
if ($LASTEXITCODE -ne 0) { throw "adding assets failed" }

& $Jar uf $Unsigned -C $Dex classes.dex
if ($LASTEXITCODE -ne 0) { throw "adding classes.dex failed" }

$ZipAlign = Join-Path $BuildTools "zipalign.exe"
& $ZipAlign -f 4 $Unsigned $Aligned
if ($LASTEXITCODE -ne 0) { throw "zipalign failed" }

$Keystore = Join-Path $Root "debug.keystore"
if (-not (Test-Path $Keystore)) {
    & $Keytool -genkeypair -keystore $Keystore -storepass android -alias androiddebugkey `
        -keypass android -keyalg RSA -keysize 2048 -validity 10000 `
        -dname "CN=Android Debug,O=Android,C=US"
    if ($LASTEXITCODE -ne 0) { throw "keytool failed" }
}

& (Join-Path $BuildTools "apksigner.bat") sign --ks $Keystore --ks-key-alias androiddebugkey `
    --ks-pass pass:android --key-pass pass:android --v4-signing-enabled false --out $Output $Aligned
if ($LASTEXITCODE -ne 0) { throw "apksigner failed" }

Write-Host "APK: $Output"
Get-Item $Output | Select-Object Name, Length
