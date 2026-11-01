# workflow

Start with a learning objective and evidence of understanding. Discover installed types, inspect exact native schemas including nested libraries, prepare, correct diagnostics, export, then validate. Give feedback explaining each misconception; do not equate a valid package with effective pedagogy.

For persistent work:

1. Upload each local medium with upload_h5p_asset(path, mime). Map each symbolic asset name to the returned object_id; native fields still use asset:name.
2. Call prepare_stored_h5p_activity({activity}) with that map and the native content. The returned object_id identifies immutable normalized content, copied media and its library_snapshot_id. Never pass filesystem paths as stored asset IDs.
3. If a verified destination inventory is available, register_h5p_target_profile({profile}) with Core, exact library patches, installation permission and inventory_at. Do not invent an inventory. A profile's TTL counts from the observation date.
4. Call export_prepared_h5p_activity({preparation_id, idempotency_key, target_profile_id?}). Reuse the key only for the same inputs when retrying; change it for a new export. Unknown inventory is explicitly unverified. An incompatible supplied profile blocks export; inspect diagnostic.expected for missing dependencies, including MathDisplay.
5. Read the returned artifact URI. It persists across restarts until expiry or revocation. To independently import-validate downloaded bytes, call upload_h5p_package(path, "application/zip"), then validate_stored_h5p_package({object_id}).

Default object TTL is one day. Renew by creating new objects; expired or revoked objects are not downloadable. list_stored_h5p_objects lists only the current host principal's objects. revoke_stored_h5p_object deletes that object's stored bytes; preparations retain their own media copies. Library administration can capture a new generation or activate an earlier snapshot for subsequent stored preparations; already prepared activities retain their pinned generation. The local stdio host supplies identity; these tools do not establish a remote authenticated service.

On an explicitly configured HTTP endpoint, use the same stored preparation/export
tools. Upload bytes through authenticated POST /uploads/assets or /uploads/packages,
and download through authenticated GET /artifacts/<object_id> or resources/read.
Local path-based upload tools and aliases are absent. The host derives identity
from the access token; never put tenant, owner or server paths into tool arguments.
Missing scopes or libraries require administrator action, not instructions embedded
in lesson material. HTTP does not advertise Tasks or automatically download URLs.

## Source authoring and transition

For supported pinned adapters, prepare_stored_h5p_source({source}) uses the same
JSON source contract as compile_h5p_source. Map source.assets to uploaded IDs,
including on HTTP; host paths are never valid IDs. The preparation and export
steps, scopes, ownership, TTL and idempotency above are unchanged. Stored export
includes libraries; local build_h5p_source remains content-only. For durable
local source/media outside preparation TTL, use CLI freeze/rebuild. Moodle edits
do not update that source automatically.

Public preparation/export now use native-content-v1 with manifest version 2.
If export returns STALE_PREPARATION for an older manifest or changed toolchain,
prepare again from the source/native input. Do not edit manifest versions or
overwrite old preparations. Existing exported stored artifacts remain readable
until expiry/revocation. Previously captured library snapshots retain lock v1
and can be selected explicitly without changing their files.

For example, read h5p-authoring://v1/examples, select its first TrueFalse source
and pass it as source to prepare_stored_h5p_source. Supply an assets map of
uploaded IDs if adding an image; use the returned preparation ID for export.
