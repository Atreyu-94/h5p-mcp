param(
    [Parameter(Mandatory=$true)][string]$Bun,
    [Parameter(Mandatory=$true)][string]$Libraries
)
$ErrorActionPreference='Stop'
$repoRoot=Resolve-Path (Join-Path $PSScriptRoot '../..')
$probeRoot=Join-Path ([IO.Path]::GetTempPath()) ('h5p-package-probe-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $probeRoot | Out-Null
& $Bun (Join-Path $PSScriptRoot 'pack.mjs') $probeRoot
if ($LASTEXITCODE) { exit $LASTEXITCODE }
$tarball=Join-Path $probeRoot 'h5p-mcp-0.1.0.tgz'
Set-Content -LiteralPath (Join-Path $probeRoot 'package.json') -Value '{"private":true}'
$previousCache=$env:BUN_INSTALL_CACHE_DIR
try {
    $env:BUN_INSTALL_CACHE_DIR=Join-Path $probeRoot 'cache'
    Push-Location $probeRoot
    try {
        & $Bun add --ignore-scripts $tarball
        if ($LASTEXITCODE) { exit $LASTEXITCODE }
    } finally { Pop-Location }
    $entry=Join-Path $probeRoot 'node_modules/h5p-mcp/dist/core/cli.js'
    & node (Join-Path $PSScriptRoot 'verify-distribution.mjs') (Join-Path $probeRoot 'node_modules/h5p-mcp')
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
    & node (Join-Path $PSScriptRoot 'bun-stdio-probe.mjs') $Bun $entry $Libraries
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
    & node (Join-Path $PSScriptRoot 'bun-stdio-probe.mjs') $Bun $tarball
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
    & $Bun (Join-Path $PSScriptRoot 'http-probe.mjs') $entry $Libraries
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
    & node (Join-Path $PSScriptRoot 'authoring-probe.mjs') $Bun $probeRoot 'h5p-mcp'
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
    Write-Output "Native installed package, authoring and transport checks passed: $probeRoot"
} finally { $env:BUN_INSTALL_CACHE_DIR=$previousCache }
