$ErrorActionPreference = 'Stop'
$script = Join-Path (Split-Path -Parent $PSScriptRoot) 'configure-firebase.ps1'
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$work = Join-Path $tempRoot ('notify-firebase-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
$inputFile = Join-Path $work 'synthetic-google-services.json'
$output = Join-Path $work 'generated\firebase-test.xml'
$passed = 0
function New-Config {
    return @{
        project_info = @{ project_number = '123456789012'; project_id = 'notify-demo-123' }
        client = @(@{
            client_info = @{ mobilesdk_app_id = '1:123456789012:android:abcdef1234567890'; android_client_info = @{ package_name = 'dev.notifyalarm' } }
            api_key = @(@{ current_key = 'AIza' + ('a' * 35) })
        })
    }
}
function Write-Config($config) { $config | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $inputFile -Encoding UTF8 }
function Expect-Rejected([string]$name, [scriptblock]$change) {
    $config = New-Config
    & $change $config
    Write-Config $config
    $before = [IO.File]::ReadAllText($output)
    $rejected = $false
    try { $null = & $script -GoogleServicesJson $inputFile -OutputPath $output }
    catch { $rejected = $true }
    if (-not $rejected) { throw "Expected rejection: $name" }
    if ([IO.File]::ReadAllText($output) -cne $before) { throw "Rejection overwrote existing output: $name" }
    $script:passed++
    Write-Output "PASS $name (existing output preserved)"
}
try {
    Write-Config (New-Config)
    $log = & $script -GoogleServicesJson $inputFile -OutputPath $output
    [xml]$generated = Get-Content -Raw -Encoding UTF8 -LiteralPath $output
    $strings = @($generated.resources.string)
    if ($strings.Count -ne 4) { throw 'Expected four Firebase resource strings' }
    if (($strings | Where-Object name -eq 'google_app_id').'#text' -cne '1:123456789012:android:abcdef1234567890') { throw 'Wrong app ID resource' }
    if (($strings | Where-Object name -eq 'gcm_defaultSenderId').'#text' -cne '123456789012') { throw 'Wrong sender ID resource' }
    if (($strings | Where-Object name -eq 'project_id').'#text' -cne 'notify-demo-123') { throw 'Wrong project ID resource' }
    if (($log -join '') -match 'AIza|123456789012|abcdef1234567890|notify-demo-123') { throw 'Script output disclosed configuration values' }
    $passed++; Write-Output 'PASS valid synthetic config generates expected resources without printing values'
    Expect-Rejected 'wrong package' { param($c) $c.client[0].client_info.android_client_info.package_name = 'dev.other' }
    Expect-Rejected 'case-sensitive package' { param($c) $c.client[0].client_info.android_client_info.package_name = 'DEV.NOTIFYALARM' }
    Expect-Rejected 'duplicate matching client' { param($c) $c.client = @($c.client[0], $c.client[0]) }
    Expect-Rejected 'missing API key' { param($c) $c.client[0].api_key = @() }
    Expect-Rejected 'invalid project ID' { param($c) $c.project_info.project_id = 'INVALID PROJECT' }
    Expect-Rejected 'invalid project number' { param($c) $c.project_info.project_number = 'not-a-number' }
    Expect-Rejected 'wrong application platform' { param($c) $c.client[0].client_info.mobilesdk_app_id = '1:123456789012:ios:abcdef1234567890' }
    Expect-Rejected 'sender/app ID mismatch' { param($c) $c.client[0].client_info.mobilesdk_app_id = '1:555555555555:android:abcdef1234567890' }
    Expect-Rejected 'invalid API key' { param($c) $c.client[0].api_key[0].current_key = 'bad key with spaces' }
    Expect-Rejected 'missing project info' { param($c) $c.Remove('project_info') }
    $marker = 'SYNTHETIC_PRIVATE_TEXT_MUST_NOT_APPEAR'
    ('{' + $marker) | Set-Content -LiteralPath $inputFile -Encoding UTF8
    $caught = $null
    try { $null = & $script -GoogleServicesJson $inputFile -OutputPath $output } catch { $caught = $_ }
    if ($null -eq $caught -or ($caught | Out-String) -match $marker) { throw 'Malformed JSON was accepted or disclosed parser input' }
    $passed++; Write-Output 'PASS malformed JSON failure does not echo input text'
    $caught = $null
    try { $null = & $script -GoogleServicesJson (Join-Path $work 'missing.json') -OutputPath $output } catch { $caught = $_ }
    if ($null -eq $caught) { throw 'Missing file was accepted' }
    $passed++; Write-Output 'PASS missing file rejected without generating configuration'
    Write-Output "PASS $passed tests; synthetic files only in OS temp; app Firebase resources untouched"
} finally {
    $resolvedWork = [IO.Path]::GetFullPath($work)
    if (-not $resolvedWork.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing cleanup outside OS temp' }
    if (Test-Path -LiteralPath $resolvedWork) { Remove-Item -LiteralPath $resolvedWork -Recurse -Force }
}
