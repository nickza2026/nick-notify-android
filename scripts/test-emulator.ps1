param([string]$Serial = 'emulator-5580')
$ErrorActionPreference = 'Stop'
if ($Serial -notmatch '^emulator-[0-9]+$') { throw 'This automated smoke test only permits an emulator, not a user phone.' }
$root = Split-Path -Parent $PSScriptRoot
$sdk = $env:ANDROID_HOME
if (-not $sdk) { $sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$adb = Join-Path $sdk 'platform-tools\adb.exe'
function Invoke-Adb {
    param([string[]]$Arguments)
    $output = & $adb -s $Serial @Arguments
    if ($LASTEXITCODE -ne 0) { throw "ADB command failed: $($Arguments[0])" }
    return $output
}
Push-Location $root
try {
    $boot = Invoke-Adb -Arguments @('shell','getprop','sys.boot_completed')
    if ($boot -notmatch '1') { throw 'Emulator is not booted' }
    Invoke-Adb -Arguments @('install','-r','app\build\outputs\apk\debug\app-debug.apk')
    Invoke-Adb -Arguments @('install','-r','app\build\outputs\apk\androidTest\debug\app-debug-androidTest.apk')
    Invoke-Adb -Arguments @('shell','pm','grant','dev.notifyalarm','android.permission.POST_NOTIFICATIONS')
    $output = Invoke-Adb -Arguments @('shell','am','instrument','-w','dev.notifyalarm.test/dev.notifyalarm.AlarmInstrumentation')
    $dir = Join-Path $root 'artifacts'
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    $output | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $dir 'instrumentation.txt')
    $output | Write-Output
    $combined = $output -join "`n"
    if ($combined -notmatch 'PASS:' -or $combined -match 'FAIL:|INSTRUMENTATION_FAILED|shortMsg=') {
        throw 'Instrumentation did not report success'
    }
    Invoke-Adb -Arguments @('shell','am','start','-n','dev.notifyalarm/.MainActivity')
    Invoke-Adb -Arguments @('shell','uiautomator','dump','/sdcard/notify-alarm-ui.xml')
    Invoke-Adb -Arguments @('pull','/sdcard/notify-alarm-ui.xml',(Join-Path $dir 'emulator-ui.xml'))
    Invoke-Adb -Arguments @('shell','screencap','-p','/sdcard/notify-alarm-screen.png')
    Invoke-Adb -Arguments @('pull','/sdcard/notify-alarm-screen.png',(Join-Path $dir 'emulator-screen.png'))
    Write-Output 'Local emulator smoke test passed. Host audio was not verified; real Pixel and FCM tests remain required.'
} finally { Pop-Location }
