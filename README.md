# H5P MCP

Create H5P activities through Bun, the official MCP SDK and a native TypeScript backend, using each installed content
type's native schema instead of four fixed quiz templates.

## Native content backend

JSON authoring is available through local MCP `compile_h5p_source`, `check_h5p_source`
and `build_h5p_source`, or CLI `compile`, `check` and `build`. It supports pinned
TrueFalse, MultiChoice, Blanks, QuestionSet and Accordion sources, reads JSON/YAML,
and exports content-only packages without Lumi. CLI freeze/rebuild preserves source,
media and pinned libraries outside preparation TTL.
See [JSON authoring v1](docs/architecture/012-json-authoring.md) for schema, examples,
scoring, translations and destination requirements.

Public native preparation/export and persistent CLI/MCP/HTTP workflows use the
native backend. Native and stored exports include libraries; source build/rebuild
remain content-only. Persistent source authoring uses prepare_stored_h5p_source
with uploaded asset IDs. Old preparations require explicit re-preparation;
existing stored artifacts remain readable. See [data transition](docs/architecture/013-native-transition.md)
and [native backend contract](docs/architecture/011-native-content.md).

## Optional local scientific figures (pilot)

The local CLI and stdio MCP can render a vertical equilibrium diagram with two
equal, opposite forces. On a new host, enable the feature, install the pinned
Typst compiler and prepare the pinned scientific package profile:

```powershell
$env:H5P_MCP_TYPST_ENABLED = '1'
$env:H5P_MCP_TYPST_PROVIDER = 'managed'
$env:H5P_MCP_TYPST_PACKAGES = Join-Path (Get-Location) 'figure-packages'
h5p-mcp figure install
h5p-mcp figure setup $env:H5P_MCP_TYPST_PACKAGES
h5p-mcp figure status
```

For an existing Typst 0.15.1 on PATH, choose the `system` provider and skip
`figure install`. An explicit absolute `H5P_MCP_TYPST_BIN` takes precedence
over either provider. Setup requires a new package directory; you can also
select an existing verified profile containing the same pinned package trees.

The installer supports x64 and ARM64 on Windows, macOS and Linux (musl binaries).
It uses the system tar utility to read three named archive members. It checks the
release and executable digests, retains LICENSE and NOTICE, and activates the
binary only after a smoke compile. A repeated install reuses a valid copy.
Use `figure repair` to stage a fresh copy and `figure remove` to remove managed
compiler builds. Previous builds are retained until removal, so a failed update
does not discard the previous selection. Removal leaves package profiles and
editable figures intact. The installer never modifies PATH.

Save this example as `force.json` and run `h5p-mcp figure force force.json my-figure`
to create a new editable directory:

```json
{"forceN":8,"upLabel":"Tension","downLabel":"Weight","alt":"Two vertical arrows of equal length start at the body. Tension is 8 N upward and weight is 8 N downward."}
```

The result contains editable Typst and JSON, an SVG master, a PNG at 192 ppi,
and a manifest with hashes, dimensions and alternative text. Use `figure.png`
as an image asset in the existing H5P build flow. Re-run the command with the
saved JSON to regenerate the diagram.

The local stdio MCP exposes `render_force_figure` when its host starts with
`H5P_MCP_TYPST_ENABLED=1`. Send the same four fields as the CLI example. The
result includes the local editable directory, a PNG preview readable with
`resources/read`, and an `asset_id` usable in the asset map for
`prepare_stored_h5p_activity` or `prepare_stored_h5p_source`. The stored PNG
expires after one day; the editable export directory persists. Set the same
compiler provider and package root in the MCP process environment.
Installation is a host CLI operation. HTTP clients cannot invoke the renderer.
H5P playback consumes the embedded PNG without Typst.

The local renderer accepts the fixed template's JSON fields. Labels are data.
Typst runs in a private figure directory with verified packages; package tree
links are rejected. Each SVG or PNG output is limited to 4 MiB while compiling.
The runner requires one page and checks the 16-million-pixel budget at 192 ppi
before rasterizing.

For AI-authored diagrams, enable the local stdio tool `render_typst_figure` with
`H5P_MCP_TYPST_ENABLED=1`, `H5P_MCP_TYPST_SANDBOX=docker` and the verified
`H5P_MCP_TYPST_PACKAGES` directory from figure setup. Supply `source` (one
editable Typst document, up to 64 KiB) and `alt`. Use built-ins or the pinned scientific packages. For drawings use
`@preview/cetz:0.5.3`, for data plots `@preview/lilaq:0.6.0`, for chemical notation `@preview/chemformula:0.1.3` and for molecular structures `@preview/typed-smiles:0.13.0`. To upgrade an existing CeTZ-only installation, run `figure setup` into a new directory and point `H5P_MCP_TYPST_PACKAGES` there. Rebuilding a saved figure uses its recorded profile. The bundle contains the original source, SVG master
and PNG. The renderer returns a PNG preview and the default H5P uses that raster.

Prepare a local Linux Docker Engine and explicitly pull the pinned official
compiler once:

```sh
docker pull ghcr.io/typst/typst@sha256:032e292249bcd378480cc7c142cfa324b63ef8aadeb88d7e7230320c4c9c422f
```

The runner uses the Docker Desktop Linux pipe on Windows or the local
`/var/run/docker.sock` socket on Unix. Each compile has two read-only input
mounts, a read-only root, no external network, no capabilities, a non-root UID,
a 256 MiB memory limit with no extra swap, one CPU and a 64-process limit.
Rendering requires an available local engine with these limits. The image is
never pulled during a request. Source rendering is unavailable over HTTP.

For a single Typst compilation, install the optional raster tools for the architecture
of the local Linux engine (AMD64 or ARM64). Run setup in an allowed export root:

```sh
docker pull ubuntu@sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852
h5p-mcp figure raster-setup /absolute/path/to/new-raster-profile
```

Set `H5P_MCP_TYPST_RASTER_DIR` to that absolute directory in the stdio server
environment. Setup downloads resvg 0.49.0 and oxipng 10.2.1 from their GitHub
releases and verifies both archives and executables. Rendering validates SVG and
page geometry first. A second isolated container converts that SVG at 192 ppi
and compresses the PNG losslessly. The manifest records both versions, binary
hashes, architecture, container image digest and compression level. Existing
figure projects retain their recorded rendering method when rebuilt. Without
a configured raster profile, new projects use the original direct Typst PNG.
Clients can read package guidance and editable examples through
`skill://typst-graphics/SKILL.md` and its declared resources.

The general tool also returns a text resource at `source.uri` scoped to the same
owner and expiration as the PNG. Copy the local figure directory for durable
editing. To capture a figure with an activity, use the asset key from its JSON
source and the directory returned by the renderer:

```sh
h5p-mcp freeze activity.json lesson --figure curve /path/to/figure-directory
h5p-mcp rebuild lesson lesson-copy.h5p
```

Freeze verifies the matching PNG and copies the generating files to
`lesson/figures/curve/`. The exact H5P rebuild uses the captured PNG and works
without Typst. For a revision, edit a copy of the figure directory, then run
`h5p-mcp figure rebuild /path/to/edited-copy /path/to/new-figure` with the
offline renderer enabled. Point the activity's asset at the new PNG and freeze
a new project. The reader supports both v1 and v2. Exact reconstruction in either format requires the backend recorded in the project lock.

See the [scientific figure examples](examples/scientific-figures/README.md) for editable source and Spanish prompts, visible data alternatives and feedback.

### Embedding a static SVG for a verified destination

Regular figure rendering still returns a PNG asset for default H5P Core. Both
master generation and SVG uploads validate a bounded static path/glyph subset.
The policy checks namespaces, geometry, paths and internal references. It rejects
scripts, foreign elements, stylesheets, external resources and embedded rasters.

To require a vector for a specific destination:

1. Register its library inventory with `register_h5p_target_profile`. The host
   operator verifies SVG **content** import and playback at that destination
   and lists its exact returned profile ID in `H5P_MCP_SVG_CONTENT_TARGETS`
   (comma-separated IDs in the MCP server environment). A new profile needs
   its own approval. This setting affects only the MCP.
2. Upload the master file with `upload_h5p_asset`, MIME `image/svg+xml`.
   The immutable owner-scoped asset can be read through the returned SVG URI.
3. In the activity image, use the SVG asset ID and `image/svg+xml`.
   Prepare through `prepare_stored_h5p_source` or `prepare_stored_h5p_activity`.
   Pass the approved `target_profile_id` to `export_prepared_h5p_activity`
   and to `validate_stored_h5p_package`. A missing or unapproved target rejects
   vector export. For an ordinary destination use the renderer's PNG asset.

## Workflow

HTTP is opt-in: `h5p-mcp http <host-config.json>`. It requires configured OIDC
access JWTs, public JWKS and operation scopes, and binds only to loopback.
See [authenticated HTTP](docs/architecture/010-authenticated-http.md) for setup,
uploads, tenant isolation, quotas and the remaining public-hosting checks.

For immutable preparations and artifacts that survive server restarts, use the
[persistent workflow](.agents/skills/h5p-authoring/references/workflow.md): upload
assets → `prepare_stored_h5p_activity` → `export_prepared_h5p_activity` → read the
artifact resource. It provides ownership checks, TTL, idempotent retries and
library snapshots. Optional destination inventories check dependencies such as
MathDisplay; an unknown inventory is never reported as compatible. See
[F5 storage operations](docs/architecture/009-persistent-storage.md) for limits
and rollback. The existing local workflow below remains supported.

1. `search_h5p_types(query, installed_only, offset, limit)` discovers
   cached Hub entries and installed runnable libraries. Default page size 20,
   maximum 100. `refresh_h5p_catalog` explicitly contacts the Hub; a fresh cache may be
   empty. `last_updated` is Unix time in milliseconds, or null.
2. `get_h5p_type_contract(machine_name, major_version, minor_version)` returns
   compact native fields, constraints, sublibraries and a raw-schema resource. Supply both
   version numbers for an exact version, or neither for newest installed.
   `install_h5p_library` downloads the current Hub version and dependencies if
   absent and administration is enabled. Historical versions are not substituted.
3. `prepare_h5p_activity(title, library, params, language="en", license="U",
   assets={})` returns a versioned report with diagnostics and `activity`. It checks exact-version
   native fields and fills declared defaults and nested subcontent IDs.
4. If `ok=true`, pass the normalized `activity` to
   `export_h5p_activity(activity, output_name)`. It rechecks and packages content,
   assets and libraries, returning a resource link, SHA-256, size and manifest.
   Existing files are never overwritten; downloads are never implicit.
5. Read the artifact resource to retrieve the package. Use `validate_h5p_package(path)`
   for an authorized local package. Legacy `export_h5p` still returns a local path.

`export_h5p_batch(activities, name_prefix="activity")` returns per-item results,
`count` and `succeeded`. Successful files remain when another item fails.

`authoring_supported` is generic authoring eligibility, not playback verification.
Hub Core compatibility describes the Hub version; authoring checks the exact
installed version. Supporting libraries may expose schemas without being runnable
main activities. Read nested library schemas separately at their exact versions.

### Example: Accordion

First read schemas for `H5P.Accordion 1.0` and `H5P.AdvancedText 1.1`, installing
explicitly if needed. Then call `create_h5p_activity`:

```json
{
  "title": "Cambios de estado",
  "library": "H5P.Accordion 1.0",
  "language": "es",
  "params": {
    "panels": [{
      "title": "Evaporación",
      "content": {
        "library": "H5P.AdvancedText 1.1",
        "params": {"text": "<p>El agua pasa de líquido a gas.</p>"}
      }
    }]
  }
}
```

Inspect the report, export its `activity`, then validate the returned file.
These versions are examples, not latest-version claims. Native H5P semantics are
not JSON Schema. One-field groups use the child value directly, for example
`overallFeedback` is a list rather than an object wrapping a list.

### Media

Use `{"path":"asset:diagram","mime":"image/png"}` in a native image/file field
and `assets={"diagram":"C:/absolute/diagram.png"}` at activity level. Audio/video
fields contain lists of media objects. The native backend checks formats, determines image
dimensions and embeds files, preserving source files. Missing and unreferenced
asset mappings are rejected. Remote HTTP(S) media remain URLs and need network
access during playback. Core 1.28 may reject SVG/office attachments by default.

For a ready source, call `build_h5p_source` once. It validates the source and produces a content-only package. Use `compile_h5p_source` to inspect native parameters or `check_h5p_source` to diagnose an input.

Package validation reports `package_mode` and `required_libraries`. Full packages are checked against their bundled libraries. Content-only packages use installed local schemas; absent versions are listed in `missing_local_libraries` and semantics remain unverified. Pass an owner-bound `target_profile_id` to either validation tool to list versions absent from that destination inventory in `missing_target_libraries`. This comparison uses major and minor versions. Moodle import, playback and grading require observations at the destination.

## Mathematical notation

Write LaTeX explicitly as `\( ... \)` (inline), `\[ ... \]` or `$$ ... $$`
(display). JSON requires doubled backslashes. The MCP scans nested content and
feedback for delimiters and returns a `mathematics` report during creation.
Unicode text such as `kg/m³` is not automatically converted to LaTeX.

Install the official [MathDisplay addon](https://h5p.org/mathematical-expressions)
explicitly with `h5p-mcp admin package <absolute path>`.
It is an addon, not a runnable Hub activity. Missing MathDisplay blocks LaTeX
authoring/export with setup instructions; export never downloads it. When math
is detected, exports include `H5P.MathDisplay 1.0` as an explicit preloaded
dependency and package its installed files in full export mode. Content without LaTeX
does not gain that dependency.

Preparation and re-export reject an explicitly opened math expression whose delimiter is missing or mismatched. Keep the pair within the same paragraph and text run. A line break inside a native text run is supported. To teach delimiter syntax, use a Markdown code span or a permitted HTML code element. Review the indicated source field or native parameter. Warnings flag clear single-dollar expressions such as `$x^2$` and literal TeX answer keys in Blanks 1.14. Ordinary prices and units can stay in plain text. Only semantic text fields (including defaults, translations and image alt text) and nested titles are inspected. Paths, attributes and unrelated metadata do not trigger the addon.

After upgrading the backend, prepare old inputs again when their preparation manifest is stale. Previously exported packages remain readable. Frozen sources retain their pinned libraries and rebuild checks.

Keep mathematical answer tokens in Blanks, DragText and MarkTheWords plain when
their parsers require it; render formulas in rich-text prompts and feedback.
MathDisplay renders notation; it does not grade symbolic equivalence, validate
TeX syntax or automatically translate plain formulas. Test dynamic feedback and
each chosen content type in the destination. Moodle must permit installation of
the bundled library in the H5P integration used by the activity. Updating Core
alone does not enable math rendering.

## Breaking migration

Removed: `create_mcq_quiz`, `create_true_false_quiz`, `create_fill_blanks_quiz`,
`create_questionset_quiz`, their models/generators/templates,
`markdown_to_quizzes`, `h5p_prompt_helpers` and `--generate-samples`.
Existing `.h5p` files are unaffected. The original four types remain usable
through generic authoring.

Replace export argument `quiz_data` with `activity`, and batch `quizzes` with
`activities`. Convert source data to native params after reading schemas:
TrueFalse uses `params.correct="true"`, not `correct_answer=true`. Clients must
refresh tool discovery after restarting.

## Installation

Requires Bun 1.4.4. Python, uv, Node and npm are not product runtime dependencies.

```powershell
bun install --frozen-lockfile --ignore-scripts
bun run build
bun dist/core/cli.js stdio
```

For a standalone local tarball, run `bun tests/tooling/pack.mjs C:/output`
after building, then:

```powershell
bun x --bun --package C:/output/h5p-mcp-0.1.0.tgz h5p-mcp stdio
```

The package is private and has not been published to npm. Both bin names,
`h5p-mcp` and `h5p-mcp-bun`, execute the same Bun entry point. Do not use the
source checkout raw pack command: the packaging script selects runtime, contracts, skill and license files without development tooling.

```powershell
$env:H5P_MCP_ADMIN_SCOPES = 'libraries:install'
bun dist/core/cli.js admin package C:/absolute/example.h5p
bun dist/core/cli.js admin install H5P.TrueFalse
bun dist/core/cli.js export C:/absolute/activity.json activity
bun dist/core/cli.js validate C:/absolute/activity.h5p
```

`H5P_MCP_DATA_DIR` selects the library store; `H5P_MCP_EXPORT_DIR` selects the
output directory (default: `exports` in the working directory). Use explicit
paths when migrating and test against a copy of the existing store.

**uvx migration:** change the client command to Bun only when ready. This change
does not edit client configuration. An old uvx command following main no longer
works after upgrading; freeze it at commit
`4d721aef540dd088d82db7799eac946499194033` (tag `python-final-f4`) for rollback:

```powershell
uvx --from "git+https://github.com/Atreyu-94/h5p-mcp.git@4d721aef540dd088d82db7799eac946499194033" h5p-mcp
```

## Educational skill

The packaged [h5p-authoring skill](.agents/skills/h5p-authoring/SKILL.md) guides
activity selection, schemas, feedback, assets, export and Moodle handoff.
The server exposes `io.modelcontextprotocol/skills` through the official MCP SDK.
`skills/list` and `skills/get` are tested on protocol `2026-07-28`. Read
`skill://h5p-authoring/SKILL.md` using `resources/read`. Entries carry frontmatter,
raw-byte SHA-256 and size; no directory-reading extension is advertised.
Ordinary clients can read the resource; native skill activation depends on client
support. Restart after changing the skill's startup snapshot.

## Validation limits and Core

Checks cover required fields, primitive types, select choices, list/number bounds,
exact nested libraries and asset references. Unknown fields/types fail explicitly.
Defaults come from installed semantics; language metadata does not translate UI
labels. Widget rules, conditional UI behavior, HTML sanitization and pedagogical
correctness are not fully validated. Generic authoring does not guarantee every
Hub activity works without additional editor logic or external services.

Import validation is not playback, accessibility or grade-transfer testing.
Check those in the target Moodle, whose Core and permissions must accommodate the
packaged libraries.

The native backend replaces Lumi; the distribution has no Lumi dependency or bundle.
Imports require dependencies bundled or installed at the exact major/minor version.
A newer minor version does not satisfy an older dependency. Destination Core and
library installation permissions must be checked separately in Moodle.

## Development checks

```powershell
bun run build
bun run lint
bun test tests/core
node tests/tooling/retirement-parity.mjs (Get-Command bun).Source retirement-parity.json
$report = Get-Content retirement-parity.json -Raw | ConvertFrom-Json
./tests/tooling/package-probe.ps1 -Bun (Get-Command bun).Source -Libraries (Join-Path $report.artifacts 'data/libraries')
```

Node is only the differential oracle and SDK test client, retained for at least
two stable Bun releases. CI runs the current Bun product on three operating
systems and automatically verifies the frozen Python rollback separately.
Historical Python tests live in the frozen rollback checkout; they have been
removed from main and are not the current product test command.

## License

Project source: Apache 2.0. Dependencies retain their own licenses. See NOTICE.md for preserved historical attribution and fixture licensing.

## Authoring guarantees and reproducible tests

See [HARDENING.md](HARDENING.md) for preparation manifests, stable diagnostics,
resource limits, verification stages and isolated integration tests.

## Versioned preparation contract (F2/C10)

`prepare_h5p_activity` is the new local preparation interface. It accepts the
same title, exact library, native params, language, license and local assets as
`create_h5p_activity`. On success, pass its `activity` object to `export_h5p`.
The existing tools remain available during migration.

Reports use `contract_version: "1"`. Invalid input returns `ok: false` with
`kind: "validation"`; backend failures return `kind: "operational_error"` and
MCP `isError: true`. Diagnostics include an escaped JSON Pointer, stable code,
retryability and a suggested correction. At most 100 diagnostics are returned,
with `diagnostics_truncated` indicating omitted entries. Failed preparations
do not return the activity or raw backend messages. Unexecuted verification
stages remain `not_run`; preparation does not certify Moodle playback/grading.

Read `h5p-contract://v1/schema` and `h5p-contract://v1/codes` through MCP resources
for the packaged JSON authority. The local preparation interface returns an
activity object. F5 additionally
provides persistent preparation IDs, and F6 exposes the authenticated remote
profile. See
[F2 implementation status](docs/architecture/005-f2-contracts.md) for the scope
and remaining increments.

## Local library administration (F2/C11)

Administration is disabled by default. To enable selected administrative tools
for a local stdio process, set host environment variables before starting it:

```powershell
$env:H5P_MCP_ADMIN_SCOPES = 'catalog:refresh libraries:install'
h5p-mcp
```

`catalog:refresh` exposes `refresh_h5p_catalog`. `libraries:install` exposes
`install_h5p_library` and `install_h5p_library_package(path)`. Local package
installation enforces ZIP checks and `H5P_MCP_PACKAGE_ROOTS`, may update existing
libraries, and never initializes npm or downloads Hub content implicitly.
Grant either scope independently; unknown scope names fail startup.

`H5P_MCP_IMMUTABLE=1` hides and rejects every administrative tool regardless of
scopes. Configuration is frozen at process startup.
Tool annotations do not grant permissions. Calling a hidden tool directly is
also rejected, including through stdio. These are local host permissions, not
OAuth or a remote multi-tenant security boundary.

Legacy `list_h5p_activities(refresh=true)` and
`get_h5p_activity_schema(install_if_missing=true)` require the corresponding
scope. Their default read operations remain compatible. Ordinary catalog/schema
queries preserve library/cache/configuration contents and use cleaned temporary
storage. The existing backend coordination lock is still used to serialize reads
against installations. CLI setup remains an explicit operator action in mutable
mode and does not require MCP tool scopes.

## Compact native contracts (F2.6)

`get_h5p_type_contract` describes installed semantics without installation or
network access. Its `fields` retain order, names, types, native required flags,
defaults and constraints. `x-h5p` retains widget/extension metadata and explains
limits. Groups with `value_shape: "single_field"` use the child's value directly.
This format is not JSON Schema and does not certify editor business logic.
Compact labels and descriptions are bounded to 1024 characters with truncation
flags. Complete text and UI grouping flags remain available in the raw resource.

`raw_schema` returns a URI, SHA-256, MIME and byte length of a canonical UTF-8
JSON snapshot containing complete native semantics and library metadata. The
digest refers to those exact resource bytes, not the original file formatting.
Raw-schema resources use a fixed process-local cache of eight snapshots, each
at most 2 MiB (at most 16 MiB total). The previously documented
`H5P_MCP_MAX_SCHEMA_BYTES`, `H5P_MCP_MAX_SCHEMA_SNAPSHOTS` and
`H5P_MCP_MAX_SCHEMA_CACHE_BYTES` are not supported configuration options.
After eviction or restart, call the tool again; resource reads never resolve
user-supplied filesystem paths or download anything.

Examples are currently included for TrueFalse 1.8 patch 21 only when its native
semantics SHA-256 matches the tested fixture. Other contracts return an empty
examples array. Tests exercise both published examples through real preparation;
they do not claim playback or grading evidence in Moodle.

## F2 operation contracts and evidence

`h5p-contract://v1/profiles` publishes resolved input/output schemas for the
local operations and separate ID-only remote input schemas. The opt-in F6 HTTP
transport publishes its executable remote tool profile at the same resource URI
and uses F5 durable objects and ownership checks. Public hosting remains
pending; see the HTTP deployment gates above.
Local export accepts the prepared activity object and its dependency manifest.
Native `params` remain dynamic; remote assets bind opaque IDs, never host paths.

The catalog now reports `structurally_authorable` and per-installed-version
evidence: library/patch, timestamp, schema digest, runnable/core/type checks and
unexecuted preparation/import/playback/grading checks. `authoring_supported` is a
compatibility alias. Hub presence alone is not authorability or test evidence.

New operations validate closed input envelopes and return bounded diagnostics.
Invalid content has `ok=false` without MCP `isError`; operational failures set
`isError=true`. Batch retains per-item results and marks operational failures;
successful files remain. Legacy tool names and synchronous APIs stay available.

Export tools return a `resource_link`, never package base64. Registration hashes
the exported file incrementally and does not impose the inline resource-read
limit. An export larger than that limit still succeeds and remains on disk.
Binary resource reads verify size/digest and default to 16 MiB of raw package
bytes (`H5P_MCP_MAX_RESOURCE_BYTES`) for both local and persistent artifacts,
independently of `H5P_MCP_MAX_OUTPUT_BYTES`. Base64 adds transport overhead;
Stdio clients must allow the base64 envelope too (the harness uses a 32 MiB receive buffer for the 16 MiB raw limit). HTTP also caps the full MCP response at 16 MiB. Use the authenticated
`/artifacts/<object_id>` route for large remote artifacts.

The local registry retains 128 artifacts by default (`H5P_MCP_MAX_ARTIFACTS`).
Eviction/restart invalidates their IDs without deleting exported files. The
manifest includes the exact preparation dependency snapshot. Configure a higher
resource-read limit before startup when needed. Old process-local resource IDs
are unavailable after restart; persistent IDs survive until expiry/revocation.

Exports preserve the `embedTypes` declared by the main library, including iframe-only
libraries; `div` is the fallback when the metadata omits that field. Package
metadata tests do not establish browser or Moodle playback.

## Independent package validation and Moodle handoff

The test-only PHP adapter runs the unmodified validator from
[h5p/h5p-php-library at 1e21b7a](https://github.com/h5p/h5p-php-library/tree/1e21b7a2da4ae9c4f1f9e61f7ae1038f8850fb82).
It checks the pinned validator hash and uses an empty installed-library inventory.
Install PHP with mbstring and zip for this optional check; neither PHP nor the
upstream validator belongs in the distributed runtime.

After generating retirement-parity.json, use fresh output directories:

~~~powershell
php -d extension=mbstring -d extension=zip tests/tooling/h5p-php-probe.php C:/tools/h5p-php-library retirement-parity.json C:/checks/php-validation
if ($LASTEXITCODE) { throw 'Independent package validation failed' }
./tests/tooling/moodle-handoff.ps1 -Corpus retirement-parity.json -IndependentReport C:/checks/php-validation/report.json -Destination exports/moodle-acceptance
~~~

The validator tests full packages and an intentionally missing declared library
reference. The handoff ZIP contains nine activities, hashes, the Core report,
Spanish test instructions and a results CSV. It includes no executable tools.
These checks validate structure and dependency packaging, not Moodle playback,
accessibility or gradebook behavior. Minimal media fixtures also require follow-up
with representative teaching media. Record destination versions, permissions and
student attempts in the supplied template before claiming Moodle acceptance.
