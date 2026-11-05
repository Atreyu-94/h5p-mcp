# H5P runtime compatibility

The MCP reports findings against the SHA-256 of the installed JavaScript. The same Moodle release can serve different H5P libraries, so a Moodle version alone cannot determine these findings. Preparation, compilation, export and package validation return the applicable messages in `warnings`. Content-only package validation examines the supplied local libraries. Full-package validation examines the embedded libraries. Verify which bytes the destination actually serves before applying a finding there.

| Library and script | Tested SHA-256 | Observed behavior |
| --- | --- | --- |
| H5P.Blanks 1.14.37, `js/blanks.js` | `14b1f355a73a50859b55caa065b38a5adddf023c87672210b5d7e60897603580` | Check focuses an English fallback despite the declared `a11yCheckingModeHeader` translation. |
| H5P.QuestionSet 1.21.13, `js/questionset.js` | `766f5fb176f3e117810dac81a1a43d57b3c74d2a5a7bcd7b20f4d9097e4fde2d` | The results can omit visible aggregate feedback. The live announcement concatenates fragments and punctuation. |

A changed hash suppresses these exact findings. It provides no evidence of successful playback or accessibility. The compiler supplies schema-declared UI fields and retains authored per-question and aggregate feedback. Experimental runtime patches are opt-in administrator work on a staging copy. The MCP never installs them automatically.

The [experimental patch](h5p-accessibility.patch) retains the legacy Blanks field as a fallback, adds visible QuestionSet feedback when its container is missing, and separates announcement fragments. First check the effective script hashes, save original files and test `git apply --check /path/to/h5p-accessibility.patch` from the parent of the copied library directories. Integrate through the administrator's versioned library maintenance process, refresh caches and compare the served bytes. Restore saved files to roll back. A maintained upstream update should be evaluated against the same acceptance cases. Importing content alone does not establish the runtime revision used by Moodle.

Test a wrong Spanish blank, retry and focus, including existing content with the legacy heading field. Test set outcomes 0/3, 3/3 and both 0+2 and 1+1. Inspect visible aggregate guidance, per-question points, announcement text and navigation. Use a real screen reader for spoken output and focus behavior. Keep instructor preview, student attempts, persistence, mobile and gradebook observations tied to their actual environments.

Public verification reports expose `student_attempt`, `persistence`, `accessibility` and `mobile` alongside the existing structure, semantics, importation, playback and grading states. These additional fields are optional in the schema for existing saved results. Fresh local reports initialize destination checks to `not_run`. Passing the local checks does not promote a destination status.
