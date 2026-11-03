param([Parameter(Mandatory=$true)][string]$Bun,[switch]$PackageOperations,[switch]$Transports)
$ErrorActionPreference='Stop'
$repo=Resolve-Path (Join-Path $PSScriptRoot '../..')
$root=Join-Path ([IO.Path]::GetTempPath()) ('h5p-authoring-probe-'+[guid]::NewGuid().ToString('N'))
$stage=Join-Path $root 'stage'
New-Item -ItemType Directory -Path $stage | Out-Null
foreach($folder in @('dist/core','h5p_mcp/contracts','.agents/skills/h5p-authoring','.agents/skills/typst-graphics','examples/scientific-figures')) {
 $target=Join-Path $stage $folder
 New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
 Copy-Item -LiteralPath (Join-Path $repo $folder) -Destination $target -Recurse
}
$manifest=Get-Content (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json -AsHashtable
$manifest.name='h5p-mcp-authoring-probe';$manifest.version='0.0.0'
$manifest.dependencies.Remove('@lumieducation/h5p-server') | Out-Null
foreach($key in @('bundledDependencies','scripts','devDependencies')) {$manifest.Remove($key) | Out-Null}
$manifest.files=@('dist/core','h5p_mcp/contracts','.agents/skills/h5p-authoring','.agents/skills/typst-graphics','examples/scientific-figures')
$manifest | ConvertTo-Json -Depth 30 | Set-Content (Join-Path $stage 'package.json')
Push-Location $stage
try { & $Bun pm pack --ignore-scripts --destination $root --quiet; if($LASTEXITCODE){throw 'Pack failed'} } finally {Pop-Location}
Set-Content (Join-Path $root 'package.json') '{"private":true}'
$oldCache=$env:BUN_INSTALL_CACHE_DIR
try {
 $env:BUN_INSTALL_CACHE_DIR=Join-Path $root 'cache'
 Push-Location $root
 try { & $Bun add --ignore-scripts (Join-Path $root 'h5p-mcp-authoring-probe-0.0.0.tgz');if($LASTEXITCODE){throw 'Install failed'} } finally {Pop-Location}
 if($PackageOperations){ & $Bun (Join-Path $PSScriptRoot 'package-operations-probe.mjs') $root $repo }
 else { & node (Join-Path $PSScriptRoot 'authoring-probe.mjs') $Bun $root }
 if($LASTEXITCODE){throw 'Authoring probe failed'}
 if($Transports){
  $entry=Join-Path $root 'node_modules/h5p-mcp-authoring-probe/dist/core/cli.js'
  $libraries=Join-Path $root 'data-archived/libraries'
  & node (Join-Path $PSScriptRoot 'bun-stdio-probe.mjs') $Bun $entry $libraries
  if($LASTEXITCODE){throw 'Installed stdio probe failed'}
  & $Bun (Join-Path $PSScriptRoot 'http-probe.mjs') $entry $libraries
  if($LASTEXITCODE){throw 'Installed HTTP probe failed'}
 }
} finally {$env:BUN_INSTALL_CACHE_DIR=$oldCache}
Write-Output "Authoring without Lumi passed: $root"
