# JSON authoring compiler v1

`compile_h5p_source`, `check_h5p_source` and `build_h5p_source` are local MCP
stdio tools. CLI equivalents are `compile`, `check` and `build`. All use the same
worker-isolated compiler and the native content-only backend. They do not install
libraries, select latest versions, download media or fall back to Lumi. The
production package still includes Lumi for older operations until that migration
is complete. HTTP source authoring and durable compiled sources are not advertised.

```powershell
bun dist/core/cli.js compile C:/activities/source.json
bun dist/core/cli.js check C:/activities/source.json
bun dist/core/cli.js build C:/activities/source.json example
```

Read `h5p-authoring://v1/schema`, `h5p-authoring://v1/adapters` and
`h5p-authoring://v1/examples` through MCP resources. Their packaged JSON files in
`h5p_mcp/contracts/` are the contract, supported pins and executable examples.
Sources use `schema_version: "1"`; transport contract v1, report extension v2 and
native manifest v2 are separate identities. Compiled code and contract hashes
identify the backend used for a preparation.

## Source and supported adapters

One document represents one activity. Supply project_id, id, title, type, question
and an explicit library pin with name, patch and canonical semantics SHA-256.
The compiler accepts only the supported pins in the adapter manifest: TrueFalse
1.8 patch 21, MultiChoice 1.16 patch 27, and optional Image 1.1 patch 33. Other
patches or changed semantics fail even when installed. The generic native authoring
path remains available for other libraries. Composition and YAML are later work.

Question, choices, image and project use explicit IDs. IDs within an activity
must be unique. Reordering choices retains their identities; duplicating an item
requires a new ID. Deterministic internal UUIDs derive from project/question/ID,
not array positions. Native MultiChoice has positional answers and no option-ID
field: its option identity is retained in the compiler report and normalized
source, not injected as an unknown native field. The source map links native
answer indices to the corresponding source entries after ordering.

Repeated compilation of unchanged source, libraries, assets and backend produces
the same normalized content, identity map and preparation. ZIP timestamps are not
a byte-identical archive promise. Preserve your source JSON and assets; the report
is not an archive of library binaries or remote resources.

## Educational rules

- TrueFalse requires a boolean correct answer and supports correct/incorrect
  feedback, retry and show_solution. Its maximum score is one.
- MultiChoice requires at least two choices, valid unique correct_ids, mode and an
  explicit scoring policy. Single mode requires exactly one correct ID and
  all_or_nothing. Multiple mode allows either policy.
- partial_minus_incorrect maps to the pinned MultiChoice calculation: one point
  per selected correct option minus one per selected incorrect option, clamped
  to zero; maximum is the count of correct options. No custom weights or penalties
  are accepted. all_or_nothing awards one point only at 100%; otherwise zero.
- Passing is fixed at 100%. Retry and show_solution default to true; shuffle is
  false unless explicitly requested. Automatic checking is disabled.
- selected_feedback and unselected_feedback map to native option feedback.
  Global feedback.correct/incorrect map to TrueFalse behaviour or MultiChoice
  overall feedback ranges 100 and 0–99 respectively. The pinned Question library
  floors the score percentage when selecting feedback. This is content mapping,
  not a Moodle grading or accessibility test.

Unknown fields and unsupported policies fail instead of being discarded.

## Text, interface language and images

Each authored text has format plain or markdown and a value. Plain text is HTML
escaped. Markdown is a deliberately small grammar: paragraphs, line breaks,
asterisk emphasis/strong, inline code and preserved TeX delimiters `\(...\)`,
`\[...\]`, `$$...$$`. Raw HTML, links, lists, headings, underscore emphasis,
escapes outside TeX and unmatched delimiters are rejected. Use plain text for
literal punctuation outside this grammar. Native semantics and the HTML policy
still validate generated text; proposed changes are never applied silently.

Metadata language and ui.language are independent and both default to en.
Interface priority is explicit overrides, installed translation defaults, then
English semantics defaults. Missing files/defaults fail by default; ui.missing
fallback permits English with a warning. An override uses its native relative
path, for example `l10n/trueText`; unknown paths fail. Translations are read only
from the selected installed library, never from the network. Formula detection
requires installed MathDisplay; syntax/rendering and algebraic correctness remain
unverified.

An optional image requires an ID, asset reference, supported MIME, nonempty alt,
exact Image pin and copyright author/license. CLI resolves asset paths relative
to the JSON file. Local MCP requires absolute paths and respects host asset roots.
MIME and bounded bytes are checked before storage; SHA-256 filenames, dimensions
and attribution are preserved. No remote source asset URL is downloaded.

## Reports, outputs and boundaries

compile and check return diagnostics, feedback, source_map, identities and, on
success, normalized source plus prepared activity. Neither writes a package.
build compiles and publishes an exclusive content-only .h5p; existing files fail.
The destination must already have the exact library major/minor versions and a
compatible Core. Export is not evidence that an unknown destination supports it.
Use build for source documents; the older export tool remains the separate
full-library legacy workflow.

Public reports use bounded diagnostics and explicit truncation flags: at most
100 diagnostics and transformations, 2048 characters per before/after proposal,
and 20 warnings of 512 characters. report_version 2 is an additive extension of
transport contract v1, including successful and failed native stored preparations.
Backend messages and host paths are not forwarded in diagnostics. Compiler errors
identify source, adapter or native stage; generated requirements without an
original source field use an empty pointer and identify adapter context. Complete
native semantics remain accessible through raw_schema; compact labels/descriptions
are limited to 1024 characters with individual truncation flags.

Importation, playback and grading remain not_run. Test a destination separately.
The maintained external probe installs the compiler/CLI/MCP dependencies with a
fresh cache outside the checkout and asserts that Lumi cannot be resolved:

```powershell
./tests/tooling/authoring-probe.ps1 -Bun (Get-Command bun).Source
```

This probe package intentionally omits Lumi. It tests the new authoring surface,
not completion of the full product's legacy-operation retirement.
