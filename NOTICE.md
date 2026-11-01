# Third-party notices

The project source retains its existing Apache-2.0 license. This does not
relicense third-party software or H5P content libraries supplied by users.

The former backend was Lumi H5P server 10.0.4-h5pmcp.493cd3ee,
GPL-3.0-or-later, from https://github.com/Lumieducation/H5P-Nodejs-library
at 493cd3ee5c9a9b7dddaa6c6ce95750f92485dead. Its bundled runtime, tarball
and exclusive adapters have been removed. This historical attribution remains;
the frozen baseline is retained separately for comparison and rollback.

Native rules implement H5P's package/library/semantics contracts and retain
the project's existing code attribution. Runtime dependencies are declared
in package.json and bun.lock; their packages retain their own license files.
H5P fixtures retain upstream library resources and metadata, recorded in
tests/fixtures/libraries.lock.json. Missing license metadata is not a license grant.

Independent tests may use h5p/h5p-php-library (GPL-3.0, including its upstream
third-party notices) from https://github.com/h5p/h5p-php-library. That code and
PHP are external test tools, not shipped in the native runtime or npm tarball.
No public npm/OCI release is authorized by these local verification artifacts.
