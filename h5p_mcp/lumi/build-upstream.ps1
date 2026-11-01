$ErrorActionPreference = 'Stop'
$revision = '493cd3ee5c9a9b7dddaa6c6ce95750f92485dead'
$url = "https://api.github.com/repos/Lumieducation/H5P-Nodejs-library/zipball/$revision"
# Always use a fresh checkout from the pinned URL; never label arbitrary local code with this SHA.
$stage = Join-Path ([IO.Path]::GetTempPath()) ('lumi-build-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
Invoke-WebRequest $url -OutFile (Join-Path $stage 'source.zip')
Expand-Archive -LiteralPath (Join-Path $stage 'source.zip') -DestinationPath $stage
$SourceDirectory = (Get-ChildItem -LiteralPath $stage -Directory | Select-Object -First 1).FullName
$npm = if ($IsWindows) { 'npm.cmd' } else { 'npm' }
Push-Location $SourceDirectory
try {
    & $npm ci --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE) { throw 'Upstream npm ci failed' }
    & node node_modules/typescript/bin/tsc -p packages/h5p-server/tsconfig.build.json
    if ($LASTEXITCODE) { throw 'Lumi compilation failed' }
    $package = Join-Path $SourceDirectory 'packages/h5p-server'
    Copy-Item -LiteralPath (Join-Path $package 'src/schemas') -Destination (Join-Path $package 'build/src/schemas') -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $package 'assets') -Destination (Join-Path $package 'build/assets') -Recurse -Force
    # Distribute corresponding server source and its license with the compiled code.
    Copy-Item -LiteralPath (Join-Path $SourceDirectory 'LICENSE') -Destination (Join-Path $package 'LICENSE')
    Copy-Item -LiteralPath (Join-Path $SourceDirectory 'tsconfig.build.json') -Destination (Join-Path $package 'tsconfig.upstream.json')
    $config = Get-Content -LiteralPath (Join-Path $package 'tsconfig.build.json') -Raw | ConvertFrom-Json
    $config.extends = './tsconfig.upstream.json'
    $config | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $package 'tsconfig.build.json') -Encoding utf8NoBOM
    $manifest = Get-Content -LiteralPath (Join-Path $package 'package.json') -Raw | ConvertFrom-Json
    $manifest.version = '10.0.4-h5pmcp.493cd3ee'
    $manifest.files += @('src/', 'tsconfig.build.json', 'tsconfig.upstream.json', 'LICENSE')
    $manifest | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $package 'package.json') -Encoding utf8NoBOM
    & $npm pack $package --ignore-scripts --pack-destination $PSScriptRoot --quiet
    if ($LASTEXITCODE) { throw 'npm pack failed' }
    $archive = 'lumieducation-h5p-server-10.0.4-h5pmcp.493cd3ee.tgz'
    @{
        repository = 'https://github.com/Lumieducation/H5P-Nodejs-library'
        commit = $revision
        source_url = $url
        core = '1.28.0'
        archive = $archive
        sha256 = (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $archive) -Algorithm SHA256).Hash.ToLowerInvariant()
        license = 'GPL-3.0-or-later'
        modifications = 'Package version and source inclusion only; runtime source unchanged.'
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'provenance.json') -Encoding utf8NoBOM
} finally { Pop-Location }
