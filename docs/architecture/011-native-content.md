# Native content-only backend (M1)

The trusted-host Engine API accepts `backend: 'native-content'` for `prepare` and
`export`. It runs without Lumi. It uses the existing worker isolation, snapshot
acquisition, deadline/cancellation, bounded output and exclusive publication.

```typescript
const prepared = await engine.run({
  action: 'prepare', backend: 'native-content', data_dir: absoluteDataDirectory,
  activity: nativeActivity
});
const exported = await engine.run({
  action: 'export', backend: 'native-content', data_dir: absoluteDataDirectory,
  activity: prepared.activity, path: absoluteDestination
});
```

This is the internal host API used by the local JSON authoring tools and CLI
compile/check/build commands described in [JSON authoring](012-json-authoring.md).
The existing public export continues to include libraries through the legacy
backend. Selecting native-content is explicit; failure never falls back to Lumi.
Only prepare/export are supported by this backend. Administration and import
remain separate capabilities.

## Output and dependencies

The ZIP contains `h5p.json`, `content/content.json` and verified local media under
`content/media/`. It contains no library directories: the destination must already
have the exact required library major/minor versions and compatible Core. Absence
of a destination inventory is not evidence of compatibility. A lock/file digest
records the patch used for construction; it does not freeze the platform patch.

Runtime preloaded and dynamic dependencies remain distinct from editor-only
installation dependencies. Nested content and MathDisplay are explicit roots.
Unrelated installed addons are not included. The main library's embedTypes is
preserved; `div` is the fallback only when that field is absent.

Media are checked against the existing MIME/roots/byte limits. Stored paths use
SHA-256 of verified bytes and a MIME-derived extension. The exact checked bytes
are staged for the ZIP; the source is not rewritten. Dimensions are populated
for supported images. Remote media are not fetched and require destination
network access. ZIP members are stored uncompressed to avoid generating packages
that violate the configured expansion-ratio check; archive/member/total size
budgets still apply. This is not a byte-identical ZIP guarantee.

## Content policy

Native semantics still govern required fields, defaults, types, choices, bounds,
nesting and exact child library versions. Metadata currently retains the previous
supported intersection: title 1–255 characters without line breaks, language
letters/hyphens up to ten characters plus Intl.Locale validation, and the documented
H5P license identifiers. This does not expand support to all BCP 47 tags.

Text is inspected using sanitize-html with a conservative tag allowlist. Declared
library tags can narrow that allowlist; they cannot enable script/style/iframe or
active objects. Supported attributes are href/title/rel on links, table-cell
colspan/rowspan/scope and list start. Protocols are http/https/mailto; protocol
relative URLs and event handlers are rejected. Styles, classes and arbitrary
attributes are outside this initial policy, even when a library/editor allows them.

Any sanitizer change returns CONTENT_TRANSFORMATION_REQUIRED and a proposed
before/after value with a JSON Pointer. The input is not rewritten. The public
v1 diagnostic maps this code to SCHEMA_VALIDATION_FAILED. Raw proposals remain
available through the bounded report_version 2 extension. HTML maxLength is now
an explicit rejection, not silent truncation. Plain scalar length/regexp checks
remain unchanged. LaTeX and answers must be resubmitted explicitly if they violate
this policy; no automatic repair or symbolic answer evaluation occurs.

The policy is intentionally independent of Lumi's SemanticsEnforcer. Accepted
baseline corpus content is checked for preservation; accepting every editor widget
or legacy style combination is not promised. Public preparation now uses this
policy too. While full export still uses Lumi, it audits the legacy sanitizer before saving
and rejects transformations before publication. This transitional export-only check
does not restrict legitimate image dimensions or stored media paths. Widget
business logic and accessibility still require type-specific and destination testing.

## Manifest and evidence limits

Native preparations use version 2 and engine native-content-v1 with library/asset
hashes, compiled source identity and package metadata hashes of native utilities.
They cannot be confused with version 1 legacy preparations. Export re-prepares and
checks its manifest before and after writing; drift rejects publication. Keep the
preparation object when exporting. Source content is revalidated on each export.

Reports leave importation, playback and grading at not_run. Structural preflight
or corpus parity is not an independent import, Moodle playback or grade-transfer
test. CI on other platforms and destination acceptance must be recorded separately.

## Full-library native export

The internal Engine request accepts `backend: "native-content"` with
`export_mode: "with-libraries"`. Omitting export_mode retains content-only output.
Full output includes every file in the pinned dependency closure, including editor
libraries, translations, licenses and resources. Editor-only dependencies are
bundled for installation and are not announced as runtime dependencies in h5p.json.
Files are hashed before streaming into the ZIP; the final manifest check rejects
drift before publication. Member, expanded-byte and archive-byte limits apply to
the whole package. Public export and package installation retain their existing
backend until the rest of their migration is complete. Full packaging does not
certify import, playback, accessibility or grading in a destination.

## M4 package operations

Package validation, library installation, catalog queries, schema discovery and
explicit Hub refresh/download now run through independent TypeScript components.
Validation extracts into a disposable directory and never installs into the user
store. ZIP preflight applies CRC, traversal, portable collision and byte/member
checks before extraction. Native metadata, exact dependencies (including editor
and dynamic roles), Core requirements, semantics and referenced media are checked.
Packages with missing bundled dependencies fail; content-only exports require the
destination libraries and are not self-contained import-validation inputs.

Local package installation is explicit and keeps all bundled library resources.
Existing identical libraries are reused. A different patch or different bytes at
the same major/minor identity is rejected with LIBRARY_VERSION_MISMATCH; there is
no silent replacement or downgrade. Resolve that conflict in an administrator's
separate library store and activate its reviewed snapshot. Preflight and conflict
checks precede installation. Failed disk writes may leave a partial new library;
no transactional multi-library rollback is advertised.

Hub registration/refresh is explicit, preserves the existing config/cache shapes,
and sends no usage statistics or hardware identifier. Ordinary discovery reads
only installed metadata and cache, including an absent cache. Downloads are bounded
and pass the same package checks. Existing service scopes, immutable policy and
Engine writer lock still apply. Custom endpoints are host configuration. Protocol
references: https://github.com/h5p/h5p-php-library and the installed legacy protocol
reference; loopback protocol tests do not claim a live Hub acceptance test.

Generic native authoring remains available. Unknown field types, sanitizer changes,
missing exact dependencies and incompatible Core fail explicitly; editor-widget
business rules, services used during playback, accessibility and Moodle grading
remain destination checks. Public prepare/export transport migration remains M5;
the native backend already provides both content-only and full-library export.

Library installation admits the documented resource extensions and license/notice
files; server-side executable files are rejected. Invalid metadata, missing package
files and native field failures produce structural validation errors; Core and
version conflicts retain their specific codes. Package validation is an internal
import check, not an independent H5P Core or Moodle acceptance certificate.
