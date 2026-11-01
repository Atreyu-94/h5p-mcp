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

This is an internal host API. MCP/CLI authoring interfaces are a later increment.
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
internal until the richer reporting contract is exposed. HTML maxLength is now
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
