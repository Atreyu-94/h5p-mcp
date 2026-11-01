# F4 — MCP y CLI Bun optativos

Implementación: SDK oficial `@modelcontextprotocol/server@2.0.0`, negociación stdio
moderna/legacy, contratos v1, scopes administrativos y URI allowlist. Se conservan
los cinco aliases locales. Una skill contiene 13 recursos (guía, ocho referencias,
cuatro ejemplos), con digest y tamaño de los bytes servidos.

## Uso y transición

```powershell
bun install --frozen-lockfile --ignore-scripts
bun run build
bun dist/core/cli.js stdio
bun dist/core/cli.js export actividad.json actividad
bun dist/core/cli.js validate C:/ruta/actividad.h5p
bun dist/core/cli.js admin refresh
```

Administración requiere `H5P_MCP_ADMIN_SCOPES`: `catalog:refresh` o
`libraries:install`; `H5P_MCP_IMMUTABLE=1` la deshabilita. Se aplican
`H5P_MCP_PACKAGE_ROOTS`, `H5P_MCP_EXPORT_ROOTS` y `H5P_MCP_ASSET_ROOTS`.
Una lista vacía deniega todo; ausencia conserva el perfil local de confianza.
`H5P_MCP_DATA_DIR` y `H5P_MCP_EXPORT_DIR` controlan estado y salida.

Crear el tarball privado mediante `bun tests/tooling/pack.mjs <directorio>` después
del build, o `bun run pack:local`. El staging conserva Lumi y sus dependencias
vendorizadas; elimina la referencia de instalación `file:` del manifiesto final.
Bun intentaba resolver esa referencia incluso con bundledDependencies. Se incluyen
provenance, fuentes del tarball Lumi, licencias, recursos y dist; no archivos Python.

```powershell
bun x --bun --package C:/ruta/h5p-mcp-0.1.0.tgz h5p-mcp-bun stdio
```

Es un tarball local, no una versión disponible en npm. No usar directamente
`bun pm pack` desde el checkout: el script prepara el manifiesto distribuible y
ejecuta `bun pm pack --ignore-scripts`. El bin conserva `#!/usr/bin/env bun`.

Para migrar desde uvx, guardar el comando/configuración anterior y probar Bun
contra una copia del almacén antes de cambiar el cliente. El MCP activo no se
modifica. Rollback: restaurar el comando Python y su almacén previo; la referencia
Python anterior a F4 es `d9a7e817865035f68f19490f0e1d72887f801483`. Todavía no se
ha creado una release Python congelada ni ejecutado F4-R.

## Evidencia y límites

- Windows: build TS7, Oxlint y 9 pruebas Bun (72 assertions), aprobados.
- SDK oficial, cliente moderno y legacy: tools, errores, permisos, recursos,
  fallback y digest de los 13 recursos, aprobados.
- Tarball instalado fuera del checkout con caché nueva: TrueFalse, MultiChoice,
  Accordion y QuestionSet preparados, exportados e importados por Lumi.
- Proceso del servidor y workers ejecutados con Bun absoluto; PATH del servidor
  contiene solamente el directorio de Bun. Node se usa para el cliente de prueba.
- `bun x --bun --package <tarball>` probado con ambos protocolos.
- Regresión Python Skills: una prueba stdio completa aprobada.
- CI añade el mismo ensayo a Linux x64, Windows x64 y macOS; resultado pendiente.

La CLI oficial de conformance fijada en
`7169291ec0b68eb370fddcd9947313ab0d5e4156` exige `server --url` y no ofrece
transporte stdio. F4 prueba interoperabilidad con el SDK, no afirma aprobación
de esa suite HTTP. Su ejecución corresponde a F6.

F4-R debe cerrar la matriz detallada de paridad de seguridad antes de retirar
Python: en particular el preflight ZIP completo, límites/diagnósticos equivalentes,
cancelación y cierre bajo carga, y fallback de publicación en sistemas sin hardlinks.
Las pruebas anteriores no certifican reproducción, accesibilidad ni calificación
en Moodle. La publicación npm/OCI continúa condicionada por F7 y autorización.

