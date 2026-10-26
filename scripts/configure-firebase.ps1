param(
    [Parameter(Mandatory=$true)][string]$GoogleServicesJson,
    [string]$OutputPath
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
try {
    $config = Get-Content -Raw -Encoding UTF8 -LiteralPath $GoogleServicesJson | ConvertFrom-Json
} catch {
    # ConvertFrom-Json errors can include input text. Do not expose configuration
    # contents, file contents or a nested parser error to console/transcripts.
    throw 'Could not read a valid Firebase client JSON file. No configuration was generated.'
}
if ($null -eq $config -or $config -is [array] -or $null -eq $config.project_info -or $null -eq $config.client) {
    throw 'Firebase client configuration has an invalid schema.'
}
$client = @($config.client | Where-Object {
    $_.client_info.android_client_info.package_name -is [string] -and
    $_.client_info.android_client_info.package_name -ceq 'dev.notifyalarm'
})
if ($client.Count -ne 1) { throw 'Expected exactly one Android Firebase client for package dev.notifyalarm' }
$keys = @($client[0].api_key)
if ($keys.Count -lt 1 -or $keys[0].current_key -isnot [string]) {
    throw 'Firebase client configuration is missing an API key.'
}
$values = [ordered]@{
    google_app_id = $client[0].client_info.mobilesdk_app_id
    gcm_defaultSenderId = $config.project_info.project_number
    project_id = $config.project_info.project_id
    google_api_key = $keys[0].current_key
}
foreach ($v in $values.Values) { if ([string]::IsNullOrWhiteSpace([string]$v)) { throw 'Firebase client configuration is incomplete' } }
if ($values.project_id -isnot [string] -or $values.project_id -cnotmatch '^[a-z][a-z0-9-]{4,28}[a-z0-9]$') {
    throw 'Firebase project ID has an invalid format.'
}
if ([string]$values.gcm_defaultSenderId -notmatch '^[0-9]{1,20}$') {
    throw 'Firebase project number has an invalid format.'
}
if ($values.google_app_id -isnot [string] -or $values.google_app_id -cnotmatch '^1:([0-9]{1,20}):android:[a-fA-F0-9]+$') {
    throw 'Firebase Android application ID has an invalid format.'
}
if ($Matches[1] -cne [string]$values.gcm_defaultSenderId) {
    throw 'Firebase Android application ID and project number do not match.'
}
if ($values.google_api_key -notmatch '^[A-Za-z0-9_-]{20,200}$') {
    throw 'Firebase client API key has an invalid format.'
}
$xml = New-Object System.Xml.XmlDocument
$null = $xml.AppendChild($xml.CreateXmlDeclaration('1.0','utf-8',$null))
$resources = $xml.CreateElement('resources')
$null = $xml.AppendChild($resources)
foreach ($key in $values.Keys) {
    $node = $xml.CreateElement('string')
    $node.SetAttribute('name', $key)
    $node.SetAttribute('translatable', 'false')
    $node.InnerText = [string]$values[$key]
    $null = $resources.AppendChild($node)
}
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $root 'app\src\main\res\values\firebase-local.xml'
}
$outputFullPath = [IO.Path]::GetFullPath($OutputPath)
$dir = Split-Path -Parent $outputFullPath
New-Item -ItemType Directory -Path $dir -Force | Out-Null
$temporaryOutput = $outputFullPath + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
try {
    $xml.Save($temporaryOutput)
    Move-Item -LiteralPath $temporaryOutput -Destination $outputFullPath -Force
} finally {
    if (Test-Path -LiteralPath $temporaryOutput) { Remove-Item -LiteralPath $temporaryOutput -Force }
}
Write-Output 'Firebase client resources generated. Default app resource path is gitignored. Rebuild and reinstall the APK. No service-account key belongs in the app.'
