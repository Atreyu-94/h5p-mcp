# Authoring guarantees and operational limits

Preparation checks native field types, required fields/defaults, list bounds,
select options, numeric bounds and decimal precision, explicit text regexps,
and explicit plain-text length limits. The generic checker treats numeric `step`
as an editor hint, not an enforced multiple, while the subsequent independent text policy checks HTML `maxLength`.
Preparation now applies an independent text/metadata policy rather than Lumi's
SemanticsEnforcer. Text that would be changed is rejected with
`CONTENT_TRANSFORMATION_REQUIRED` and before/after proposals; input, answers and
LaTeX are not silently rewritten. HTML maxLength is explicitly rejected without
truncation. Styles/classes/arbitrary attributes are not admitted by this initial
policy. See [native content backend](docs/architecture/011-native-content.md) for
allowed tags, attributes, protocols and deliberate differences from the old backend.
Public and persistent exports use this same native policy and preserve accepted content.
Widget business rules, accessibility and symbolic equivalence still need tests.

Title/language/license retain the previously supported metadata intersection.
Language must also be accepted by Intl.Locale. Tags such as es-419 remain
unsupported rather than silently shortened. The native backend uses manifests
version 2; version 1 preparations require explicit re-preparation before export. Existing artifact bytes remain readable.

Missing nested `subContentId` values receive UUIDs. Supplied UUIDs must be valid
and unique within the activity; valid identities survive repeated preparation.
To intentionally duplicate a subtree, remove its IDs before preparing the new
composition. Export never silently repairs duplicate identities.

Prepared activities carry an opaque `preparation` manifest: SHA-256 hashes of
library files, patch versions, local assets and backend source identity. Preserve
this field when exporting. Changes produce `STALE_PREPARATION`; prepare again
and review the new result. Raw activities remain accepted for compatibility and
are checked at export, but have no earlier preparation to compare against.
This detects drift; it does not archive historical libraries, freeze remote media,
or promise byte-identical ZIPs. Local files are checked again after export, before
exclusive publication. Concurrent hostile filesystem modification is outside
this local author's trust model; hashes are not filesystem isolation.

The additive report_version 2 extension preserves bounded warnings, mathematical
requirements and transformation proposals in local and persistent preparation.
Compiler diagnostics use source pointers and explicit stages. See
[JSON authoring](docs/architecture/012-json-authoring.md) for limits and contracts.

Reports expose `verification`: structure, semantics, importation, playback and
grading each use `passed`, `failed` or `not_run`. Export does not itself run an
import, browser or Moodle grading test. MCP clients expose the JSON dictionary
through structuredContent (the client SDK may adapt its property spelling).

## Budgets

Positive integer environment variables configure these defaults:

| Variable suffix after `H5P_MCP_MAX_` | Default |
|---|---:|
| JSON_BYTES | 16777216 |
| OUTPUT_BYTES | 33554432 |
| DEPTH | 64 |
| NODES | 100000 |
| ASSET_BYTES | 67108864 |
| MEDIA_BYTES | 268435456 |
| ZIP_MEMBERS | 20000 |
| ZIP_MEMBER_BYTES | 134217728 |
| ZIP_BYTES | 536870912 |
| ZIP_ARCHIVE_BYTES | 134217728 |
| ZIP_RATIO | 1000 |
| ZIP_PATH_DEPTH | 32 |
| LIBRARIES | 1000 |
| DEPENDENCY_EDGES | 5000 |
| DEPENDENCY_DEPTH | 32 |
| BATCH | 50 |
| SECONDS | 300 |

Media reads run sequentially and are bounded even if a file grows after stat.
ZIP validation checks compressed size before opening, bounds expansion ratio,
and drains members in 64 KiB chunks to check readable byte counts and CRC before
native import. It rejects symlinks/special entries, ambiguous separators, Windows
reserved names/ADS, Unicode NFC/case-fold collisions and file/directory conflicts.
Explicit directory entries remain allowed. Package validation and administrative
installation share this preflight. Native extraction runs in the isolated worker after preflight, using exclusive files.
The Bun preflight rejects portable path collisions, including the tested Unicode
case-fold aliases. JSON input and worker output collection are bounded. Process
timeout and local interruption kill and reap the child. Python is only the frozen
rollback implementation, not part of this production path.
The parent owns the worker's TMP/TEMP/TMPDIR and removes its temporary files
even when a hard kill prevents JavaScript finally blocks from executing.
Worker stdout/stderr are collected through bounded pipes; these are operational
budgets, not an OS memory/disk sandbox. Admission and lock waits are cancellable;
prepare/validate/export jobs run in subprocesses that are killed and reaped
before staging cleanup completes. Preflight and subsequent import are not an
immutable filesystem snapshot.
Cancellation does not undo already completed batch items. OS calls blocked on a
faulty local filesystem may delay cooperative cleanup.

Optional `H5P_MCP_ASSET_ROOTS`, `H5P_MCP_PACKAGE_ROOTS`, and
`H5P_MCP_EXPORT_ROOTS` are JSON arrays of permitted absolute directories.
Roots and paths are resolved before containment checks; an empty array denies
all access of that kind. Omit a variable to retain the existing local absolute-path
workflow. These controls do not prevent a hostile local process replacing a path
between resolution and opening; stronger snapshots/isolation belong to the remote
storage phase. Internal disposable import/export paths are not user-selected roots.

Local media must match detected magic bytes and the declared MIME allowlist:
raster images, supported audio/video containers, PDF and WebVTT. SVG and HTML are
rejected. Magic bytes do not establish codec validity or browser playback. The same
bounded bytes inspected for MIME are passed to the selected storage backend; remote playback URLs are not
downloaded. Dependency manifests bound nodes, edges and depth and reject cycles.

The MCP call deadline includes thread admission, lock contention and all batch
items; it does not restart for each item. Cleanup completes before timeout returns.
Publication uses an exclusive hardlink
or a platform no-replace rename; it never copies to a visible final filename.
Unsupported atomic primitives fail explicitly. The F4-R record documents prior
Linux/macOS/Windows CI execution; new local changes still require their own CI.

MathDisplay remains the only explicitly resolved addon. Other installed addons
are not exported indiscriminately. Add new adapters only with a real content
type and regression evidence.

## Repeating verification

Run `bun run build`, `bun run lint` and `bun test tests/core` for current boundary
regressions. `tests/tooling/retirement-parity.mjs` checks the fixture hash before
the Node/Bun differential corpus. `tests/tooling/package-probe.ps1` installs a
tarball outside the checkout with a fresh cache and a Bun-only server PATH.
The automatic Python CI tests the frozen rollback commit, not the current product.

The browser smoke supports `H5P_MCP_GRADING_SMOKE=1` for a True/False fixture
whose correct answer is True, with retry enabled and LaTeX in both feedback
branches. This exercises exact wrong/correct scores and retry, not a Moodle
gradebook or all activity types. Browser prerequisites remain explicit in the
smoke script; browser tests are not part of the Python CI matrix.

## Resource registration and reads

Export registration computes size and SHA-256 by streaming the completed file;
it does not load the whole package or reject it for exceeding the inline read
limit. Local and persistent resource reads enforce `H5P_MCP_MAX_RESOURCE_BYTES`
(default 16 MiB of raw bytes). `H5P_MCP_MAX_OUTPUT_BYTES` remains a separate tool/
worker output budget. HTTP also limits the encoded MCP response to 16 MiB; use
the authenticated artifact download route for larger remote packages.

The local artifact registry retains 128 entries by default, configurable with
`H5P_MCP_MAX_ARTIFACTS`. Eviction invalidates a resource ID, not the exported file.
Raw-schema resources have a fixed cache of eight snapshots of at most 2 MiB each.

Regression tests cover large-file registration, configurable read limits for both
artifact stores, integrity, registry eviction and main-library embed modes in
actual Lumi-generated packages. The embed-mode test mutates a disposable
TrueFalse fixture; it does not certify InteractiveBook playback or Moodle grading.

The dependency lock pins the native HTML sanitizer and security updates to its
utilities. An underscore 1.13.8 override replaces jsonpath's vulnerable exact
1.13.6 dependency (GHSA-qpx9-hpmf-5gmw) while the legacy backend remains installed.
Run `bun audit` against the current advisory registry; a clean result is not a
claim that all dependencies are free of undiscovered vulnerabilities.