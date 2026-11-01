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

## Question sets

`type: "question_set"` uses pinned H5P.QuestionSet 1.21 (patch 13). Supply
`questions` (1–100 TrueFalse/MultiChoice sources), `pass_percentage` (integer
1–100), and optionally `shuffle`, `retry`, `show_solution`, and `feedback`.
Children omit `schema_version`, `project_id`, and `assets`; they inherit the root
project, asset table, language and interface language, with per-child UI overrides.
Nested containers and unsupported question types are rejected.

QuestionSet adds the children's scores and maximum scores without weights. A
multiple-choice child using partial scoring therefore contributes its number of
correct alternatives, while an all-or-nothing child contributes one point.
Aggregate `feedback.correct` means passing the configured threshold, and
`feedback.incorrect` means below it. These two texts must use `format: "plain"`;
the pinned native field does not admit formatted HTML. Child feedback remains
independent. The result page is enabled; no randomized pool or parent override
silently changes a child's scoring or retry settings.

Question IDs must be unique within the set, including the set's own ID. Reordering
preserves UUIDs; duplicating a question requires a new question ID, which also
renews its nested image/choice identities. Choice IDs are scoped to their question.
The report uses `questionId/childId` for identities below questions.

## Blanks and Accordion

Blanks pins H5P.Blanks 1.14 patch 37. `question` supplies the instruction;
`case_sensitive` is explicit. `blocks` contains 1–31 `{id, segments}` blocks.
Each segment is either a text object or `{id, answers: ["metre", "meter"]}`.
Every block requires at least one blank. Alternatives are case-sensitive when
requested; spelling-error acceptance is disabled. Each blank contributes one
point. Aggregate feedback uses 0–99/100 percent and plain text.

Markdown is rendered before blank delimiters are inserted. Literal `*` remaining
in rendered text is rejected, including in code and TeX; use a TeX command such
as `\ast` when mathematically appropriate. Answers containing `*`, `/`, `:`, HTML
brackets, newlines, or leading/trailing whitespace are rejected. The pinned H5P
parser has no backslash escape, and HTML numeric escapes are decoded by the
native sanitizer, so neither is an accepted workaround. Alternatives are an
array, never a delimiter-bearing author string. No silent answer changes occur.

Accordion pins H5P.Accordion 1.0 patch 47 and H5P.AdvancedText 1.1 patch 14.
Supply `panels: [{id, title, text, library}]` and optional `heading: "h2"|"h3"|"h4"`.
Only AdvancedText children are admitted. This is informational content: score,
feedback and retry settings are rejected. QuestionSet also admits Blanks children.

## JSON and YAML files

CLI `compile`, `check`, and `build` accept `.json`, `.yaml`, and `.yml` files.
YAML uses the pinned `yaml` parser (2.9.1) and a JSON-compatible subset: string
mapping keys, finite JSON-format numbers, booleans, null, arrays and objects.
Duplicate keys, anchors, aliases, merge keys, explicit tags/directives and
multiple documents are rejected. JSON files also reject duplicate keys. YAML
plain `yes` and dates remain strings; quote version strings such as `"1"`.
The parser uses the documented document/node and LineCounter APIs:
https://eemeli.org/yaml/ .

CLI diagnostics retain JSON Pointers and add `source_locations` with one-based
line/column coordinates, using the nearest parent for missing properties. Syntax
errors identify the document position without echoing private source text. MCP
continues to receive a structured JSON object and has no source-file coordinates.
Both formats compile through the same schema and adapters; media paths remain
relative to the source file.
