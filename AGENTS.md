# Instrucciones para agentes

## Estructura y alcance

- Este AGENTS.md se versiona y contiene las instrucciones de desarrollo del repositorio.
- Dentro de .agents/ solo se versiona .agents/skills/h5p-authoring/, la skill que forma parte del funcionamiento del MCP, con sus referencias, ejemplos y manifiesto de recursos.
- Guarda todos los planes en .agents/plans/. Las demás skills y materiales de desarrollo son locales y se excluyen mediante .git/info/exclude, no mediante cambios compartidos de .gitignore.
- Antes de crear material de desarrollo en un checkout, asegura estas reglas locales en .git/info/exclude (conserva las reglas existentes):

```gitignore
/.agents/*
!/.agents/skills/
/.agents/skills/*
!/.agents/skills/h5p-authoring/
```

- Antes de añadir archivos a Git, comprueba git status y git check-ignore. No añadas planes ni materiales locales con git add -f.
- La skill del producto tiene una única fuente en .agents/skills/h5p-authoring/. El runtime y el paquete deben cargar esa misma ruta; no mantengas copias divergentes.
- Escribe toda la skill distribuida en inglés, incluidos referencias, ejemplos, feedback y textos de interfaz de las muestras. Al crear una actividad para un docente, respeta el idioma solicitado.
- Lee README.md y HARDENING.md para los flujos y límites del producto. Consulta docs/architecture/ para las decisiones técnicas. Los planes locales contienen seguimiento histórico y no sustituyen el estado observable del código.

## PowerShell

- Usa siempre PowerShell para ejecutar comandos e implementar soluciones.
- Escribe comandos compatibles con PowerShell multiplataforma cuando sea posible.
- Usa ejecutables con extensión .exe cuando necesites específicamente la semántica de una utilidad Unix.

## Permisos y seguridad

- Cuando solicites permiso, explica qué hará el comando y por qué necesita ese permiso.
- Antes de una operación destructiva, verifica mediante comandos de solo lectura la ruta y el alcance exactos.
- No elimines, sobrescribas ni muevas datos ajenos a la tarea.
- Conserva los cambios existentes del usuario que no formen parte del trabajo solicitado.
- No publiques releases, extensiones ni paquetes, ni cambios upstream, sin autorización explícita.

## Orquestación de agentes

- El agente principal usa GPT-6 Sol/medium: orquesta, diseña, decide, escribe código, ejecuta pruebas, revisa, valida e integra.
- No uses los agentes integrados default, worker o explorer; no delegues a Terra.
- Delega solo cuando el usuario o instrucciones aplicables pidan delegación, y únicamente dentro de estas especialidades:
  - luna_high_bonito_runtime_operator: levanta, compila y supervisa Julia/Bonito sin editar código; entrega URL, PID, puerto y logs.
  - luna_low_browser_debugger: prueba una URL local mediante Chrome DevTools; no inicia servidores, navega fuera de local ni modifica código.
  - luna_high_docs_researcher: consulta documentación local/oficial, web, GitHub en solo lectura y documentos mediante Docling.
  - luna_medium_code_explorer: responde preguntas acotadas sobre código local y GitHub en solo lectura; no usa web general ni escribe código.
  - luna_high_zotero: consulta Zotero, exporta BibTeX e inserta citas con trazabilidad; respeta confirmación para escrituras en Zotero.
- Excepción: astra_medium_reviewer puede realizar una revisión con GPT-6 Astra/medium solo con aprobación explícita para ese encargo. La autorización no se extiende a encargos futuros. Trabaja en solo lectura y aplica las skills del repositorio; una revisión ciega usa fork_turns="none".
- Los agentes no se delegan entre sí. El operador entrega la URL al orquestador y este puede encargar después la prueba al debugger.
- No delegues tareas triviales ni dupliques investigación. Máximo un subagente por fase; permite dos simultáneos solo para trabajos realmente independientes.
- Prefiere contexto limpio con fork_turns="none".
- Cada encargo debe indicar objetivo, alcance, entrada, evidencia esperada y límite de salida.

## Ejecución y verificación

- Inspecciona el estado real antes de proponer o implementar cambios.
- Fundamenta las conclusiones en archivos, comandos y resultados verificables.
- Realiza pruebas proporcionales al riesgo y declara cualquier comprobación incompleta o no realizada.
- Prefiere soluciones simples, legibles y documentadas.
- Antes de añadir complejidad por un caso especulativo o una carrera remota o improbable, explica el fallo concreto, su probabilidad y el coste en complejidad, y obtén aprobación. No amplíes el alcance por robustez teórica.
- Para cambios de la skill, comprueba descubrimiento MCP, lectura e integridad de todos sus recursos y empaquetado instalado fuera del checkout.
- Distingue validación estructural/importación de reproducción, accesibilidad y transferencia de calificaciones en Moodle. No inventes comprobaciones aprobadas.

## Commits

- Usa Conventional Commits con el tipo más específico.
- Generan release: feat (minor); fix, deps, perf y refactor (patch).
- build, chore, ci, docs, style y test no generan release.
- ! o BREAKING CHANGE: genera major.
- Si un cambio interno corrige el producto distribuido, usa fix.
- Revisa la configuración de Release Please antes de commitear.
- Revisa el diff preparado para evitar incluir cambios ajenos o material de desarrollo local.

## Comentarios y planes

- Usa TODO:, FIXME:, BUG:, HACK:, [ ] y [x] cuando corresponda para que Better Todo Tree detecte pendientes y defectos.
- En planes usa encabezados, listas, tablas, alertas, Mermaid o fórmulas solo cuando ayuden a entender el contenido. No dependas de HTML crudo, imágenes Markdown, enlaces relativos o extensiones no compatibles para información esencial.
