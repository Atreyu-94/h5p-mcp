# Native backend transition

Public native prepare/export, stored preparations and exports now use
native-content-v1. Native export and stored export include libraries; authoring
build/rebuild keep their documented content-only mode. Engine generations,
worker isolation, deadlines, exclusive publication and Vault ownership remain
the boundaries for both paths.

prepare_stored_h5p_source({source, library_snapshot_id?, ttl_seconds?}) accepts
the same pinned authoring source as local compile, with assets mapped to
uploaded object IDs. It is available in stdio and authenticated HTTP with
h5p:read and h5p:author. It copies verified media and compiles in a worker against
the chosen immutable snapshot. It returns an owner-bound preparation ID and
bounded feedback; server paths and compiled host asset mappings are not returned.
Use export_prepared_h5p_activity with h5p:export and an idempotency key to
obtain a full package. Downloads remain authenticated. These preparation objects
have TTL; they do not replace the durable local freeze/rebuild source unit.

## Existing data

- Snapshot locks remain version 1. Existing snapshots are read and integrity
  checked without modifying their files. Capture/activate affects subsequent
  preparation; existing preparations retain their chosen snapshot.
- Native preparations use manifest version 2 and engine native-content-v1,
  including backend, library and asset hashes. Version 1, unknown identities or
  changed hashes fail export with STALE_PREPARATION. Prepare again explicitly
  from the original input; never change a manifest version by hand.
- Re-preparation produces a new immutable object. Old preparation bytes are not
  migrated or overwritten. Expiry, revocation and owner/tenant checks still apply.
- Existing artifact payloads need no migration. Read/download and idempotent
  replay remain available until expiry or revocation, even if their preparation
  was made by a previous backend.
- Local process-only artifact URIs still expire at restart; stored artifact IDs
  remain durable. New exports never overwrite an existing destination.

## Upgrade and rollback

Stop writers and retain the previous executable plus a consistent copy of the
whole object store (SQLite database and object files) and installed library store.
Run the new version against a separate copy. Confirm snapshot integrity, inspect
new preparation diagnostics and verify exported packages before activating that
copy. Do not point two versions at the same mutable store.

To roll back, stop the new runtime and select the previous executable and its
unchanged store copy. Preserve the new copy and source/media files for later
reconciliation. Snapshot activation alone rolls back library selection, not
backend code or database state. No active host is reconfigured automatically.

Lumi files and its dependency have been removed from the distribution; execution never
falls back to them. Structural checks are not independent H5P Core, Moodle
playback, accessibility or grading acceptance.
