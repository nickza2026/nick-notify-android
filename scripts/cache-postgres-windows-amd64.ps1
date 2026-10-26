param()
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT' -or (go env GOARCH) -ne 'amd64') {
    throw 'This helper is only for Windows AMD64. Other platforms use the Go embedded library directly.'
}
$cache = if ($env:NOTIFY_PG_CACHE) { $env:NOTIFY_PG_CACHE } else { Join-Path $env:LOCALAPPDATA 'notify-alarm\embedded-postgres' }
$target = Join-Path $cache 'embedded-postgres-binaries-windows-amd64-16.9.0.txz'
if (Test-Path -LiteralPath $target) {
    Write-Output 'Archive already cached; no download or overwrite.'
    exit 0
}
$url = 'https://repo.maven.apache.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-windows-amd64/16.9.0/embedded-postgres-binaries-windows-amd64-16.9.0.jar'
$temp = Join-Path ([IO.Path]::GetTempPath()) ('notify-pg-' + [Guid]::NewGuid().ToString('N') + '.jar')
try {
    # One request per artifact, no retry loop. A 429 must not be treated as a missing version.
    Invoke-WebRequest -Uri $url -OutFile $temp -UseBasicParsing -TimeoutSec 60
    $expected = (Invoke-WebRequest -Uri ($url + '.sha256') -UseBasicParsing -TimeoutSec 15).Content.Trim().ToLowerInvariant()
    $actual = (Get-FileHash -LiteralPath $temp -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($expected -notmatch '^[a-f0-9]{64}$' -or $actual -ne $expected) { throw 'Official SHA-256 verification failed; nothing installed or executed.' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($temp)
    try {
        $entries = @($zip.Entries | Where-Object { $_.Name.EndsWith('.txz') })
        if ($entries.Count -ne 1) { throw 'Unexpected Maven archive layout' }
        [IO.Directory]::CreateDirectory($cache) | Out-Null
        $partial = $target + '.' + [Guid]::NewGuid().ToString('N') + '.partial'
        $input = $entries[0].Open()
        $output = [IO.File]::Create($partial)
        try { $input.CopyTo($output); $output.Flush($true) }
        finally { $output.Dispose(); $input.Dispose() }
        # Non-overwriting atomic publication. The archive contains public binaries, no DB data.
        [IO.File]::Move($partial, $target)
        Write-Output 'PASS official binary checksum verified and cached; no system PostgreSQL installed.'
        Write-Output ('Archive SHA-256: ' + $actual)
    } finally { $zip.Dispose() }
} finally {
    # Exact caller-created temporary file only; no recursive delete or computed shell commands.
    if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp }
}
