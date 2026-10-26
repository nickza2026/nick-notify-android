param([switch]$WithTests)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$originalJavaOpts = $env:JAVA_OPTS
Push-Location $root
try {
    # Thai Windows locale can select a Buddhist calendar (year 2569), outside ZIP's
    # DOS timestamp range. Scope the Gregorian locale to this build's JVM only.
    $env:JAVA_OPTS = "$originalJavaOpts -Duser.language=en -Duser.country=US"
    if (-not $env:JAVA_HOME) {
        $jbr = 'C:\Program Files\Android\Android Studio\jbr'
        if (Test-Path -LiteralPath $jbr) { $env:JAVA_HOME = $jbr }
    }
    if (-not $env:ANDROID_HOME) {
        $sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
        if (Test-Path -LiteralPath $sdk) { $env:ANDROID_HOME = $sdk }
    }
    $tasks = @(':app:assembleDebug')
    if ($WithTests) { $tasks += @(':app:assembleDebugAndroidTest', ':app:testDebugUnitTest', ':app:lintDebug') }
    & .\gradlew.bat @tasks --console=plain
    if ($LASTEXITCODE -ne 0) { throw "Android build failed ($LASTEXITCODE)" }
    $out = Join-Path $root 'artifacts'
    New-Item -ItemType Directory -Path $out -Force | Out-Null
    Copy-Item -LiteralPath 'app\build\outputs\apk\debug\app-debug.apk' -Destination (Join-Path $out 'notify-alarm-poc-debug.apk') -Force
    Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $out 'notify-alarm-poc-debug.apk') | Format-List
    Write-Output 'Debug-signed PoC APK only. This is not a production release signing key.'
} finally { $env:JAVA_OPTS = $originalJavaOpts; Pop-Location }
