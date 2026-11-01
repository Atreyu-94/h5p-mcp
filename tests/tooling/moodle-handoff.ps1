param(
 [Parameter(Mandatory=$true)][string]$Corpus,
 [Parameter(Mandatory=$true)][string]$IndependentReport,
 [Parameter(Mandatory=$true)][string]$Destination
)
$ErrorActionPreference='Stop'
$report=Get-Content -LiteralPath $Corpus -Raw | ConvertFrom-Json
$core=Get-Content -LiteralPath $IndependentReport -Raw | ConvertFrom-Json
$destinationPath=[IO.Path]::GetFullPath($Destination)
if ((Test-Path -LiteralPath $destinationPath) -or (Test-Path -LiteralPath "$destinationPath.zip")) { throw 'Destination already exists' }
if ($report.status -ne 'passed' -or $report.packages.Count -ne 9) { throw 'Expected the validated nine-case corpus' }
New-Item -ItemType Directory -Path $destinationPath | Out-Null
$activities=New-Item -ItemType Directory -Path (Join-Path $destinationPath 'actividades')
$expectations=@(
 'Verdadero: 1/1. Falso: 0/1.',
 'Metro: puntuación completa. Segundo: cero.',
 'Expandir Masa: aparece explicación. Sin calificación.',
 'Verdadero: puntuación completa y pantalla final; probar también Falso.',
 'metre: correcto. second: incorrecto.',
 'Fórmula 1+1=2 sin delimitadores TeX visibles. Verdadero: correcto.',
 'Imagen PNG de 1x1 y texto alternativo Image; Verdadero: correcto. Fixture mínima.',
 'Audio WAV PCM de 0.2 segundos de silencio: controles sin error. No demuestra reproducción de voz.',
 'Vídeo WebM de prueba y póster mínimo: carga y controles sin error; Verdadero: correcto.'
)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$rows=@();$cases=@();$hashes=@();$inventory=@()
for ($i=0;$i -lt $report.packages.Count;$i++) {
 $item=$report.packages[$i];$name=[IO.Path]::GetFileName($item.file)
 $sha=(Get-FileHash -LiteralPath $item.file -Algorithm SHA256).Hash.ToLowerInvariant()
 if ($sha -ne $item.sha256) { throw "Changed package: $name" }
 $validated=@($core.packages | Where-Object { $_.file -eq $name -and $_.sha256 -eq $sha -and $_.ok })
 if ($validated.Count -ne 1) { throw "No independent validation: $name" }
 Copy-Item -LiteralPath $item.file -Destination (Join-Path $activities $name)
 $zip=[IO.Compression.ZipFile]::OpenRead($item.file)
 try {
  foreach ($entry in $zip.Entries | Where-Object { $_.FullName -match '^[^/]+/library\.json$' }) {
   $reader=[IO.StreamReader]::new($entry.Open())
   try { $library=$reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
   $inventory+=[pscustomobject]@{archivo=$name;biblioteca=$library.machineName;major=$library.majorVersion;minor=$library.minorVersion;patch=$library.patchVersion;core=$(if ($library.coreApi) {"$($library.coreApi.majorVersion).$($library.coreApi.minorVersion)"} else {"no declarado"});licencia=$library.license}
  }
 } finally { $zip.Dispose() }
 $hashes+="$sha  actividades/$name"
 $cases+="| $name | $($item.title) | $($item.library) | $($expectations[$i]) |"
 foreach ($check in @('importacion','reproduccion','feedback','reintento','finalizacion','gradebook','teclado','lector_pantalla','zoom_contraste')) {
  $rows+=[pscustomobject]@{archivo=$name;prueba=$check;estado='pendiente';resultado_esperado=$expectations[$i];observado='';evidencia='';incidencia=''}
 }
}
$inventory | Export-Csv -LiteralPath (Join-Path $destinationPath 'bibliotecas.csv') -NoTypeInformation -Encoding utf8BOM
$rows | Export-Csv -LiteralPath (Join-Path $destinationPath 'resultados.csv') -NoTypeInformation -Encoding utf8BOM
$hashes | Set-Content -LiteralPath (Join-Path $destinationPath 'SHA256SUMS.txt')
$core | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $destinationPath 'validacion-core.json')
@'
# Pruebas de aceptación en Moodle — entrega al DT

Objetivo: comprobar en un curso de pruebas los paquetes del backend nativo de h5p-mcp.
Los nueve archivos incluyen bibliotecas. No instalar en producción ni actualizar bibliotecas compartidas sin revisar su alcance con el administrador.

## Estado

validacion-core.json documenta validación estructural independiente con H5P PHP Core. No certifica reproducción, accesibilidad, puntuación ni transferencia de notas en Moodle: están pendientes.
Este corpus es de diagnóstico: imagen de 1x1, audio silencioso y vídeo mínimo. Repetir además con medios educativos representativos para aceptación audiovisual y accesibilidad completa.

Los ejemplos conservan interfaces en inglés (True/False, Retry); no son actividades finales traducidas.

## Entorno que debe registrar el DT

- Fecha, responsable y curso:
- Versión de Moodle y PHP:
- Integración: mod_h5pactivity (nativa) o mod_hvp (plugin), versión:
- H5P Core, navegador, sistema operativo y lector de pantalla:
- Bibliotecas y parches antes/después:
- Roles: administrador/importador, docente y estudiante:
- Permisos para subir contenido e instalar/actualizar bibliotecas:
- Nota máxima, regla de intentos/calificación y finalización:

## Procedimiento

1. Descomprimir. Conservar nombres y SHA256SUMS.txt. bibliotecas.csv enumera las versiones incluidas en cada paquete; licencia vacía significa metadato no declarado.
2. Usar curso y cuentas de prueba. Registrar bibliotecas previas; evaluar alcance antes de actualizaciones globales.
3. Crear una actividad por H5P. En integración nativa, importar al banco de contenido si corresponde y crear después la actividad evaluable. Un contenido incrustado no demuestra integración con el libro de calificaciones.
4. Si faltan permisos, Core o bibliotecas compatibles, registrar mensaje literal y marcar bloqueado. No cambiar versiones a ciegas.
5. Como estudiante, probar respuesta incorrecta y correcta. Registrar puntos, feedback, soluciones, reintento y pantalla final; conservar capturas y número de intento.
6. Como docente, comprobar intentos y libro de calificaciones. Puntuación correcta escala a la nota máxima configurada; mejor/último/promedio depende de la regla registrada. Acordeón y audio: gradebook no_aplica.
7. Recargar y volver a entrar para comprobar estado/finalización según configuración. La vista de docente no sustituye un intento real de estudiante.
8. Probar Tab/Enter/Espacio, foco visible, ausencia de trampas, lector de pantalla, etiquetas, texto alternativo, zoom 200% y contraste. Fixtures mínimas no prueban subtítulos/transcripciones.
9. Rellenar resultados.csv: aprobado, fallido, bloqueado o no_aplica, con evidencia. Fallos: pasos, esperado, observado y configuración; evitar datos personales de alumnos.
10. Devolver resultados.csv, ficha de entorno y capturas/logs. No hace falta ejecutar scripts ni dar acceso remoto.

## Casos

| Archivo | Título | Biblioteca | Resultado esperado |
|---|---|---|---|
'@ | Set-Content -LiteralPath (Join-Path $destinationPath 'LEEME.md')
$cases | Add-Content -LiteralPath (Join-Path $destinationPath 'LEEME.md')
Compress-Archive -LiteralPath (Get-ChildItem -LiteralPath $destinationPath).FullName -DestinationPath "$destinationPath.zip"
Get-FileHash -LiteralPath "$destinationPath.zip" -Algorithm SHA256
