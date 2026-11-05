# Moodle player accessibility fixes

The optional [host patch](h5p-accessibility.patch) targets two specific library releases.

| Library | Symptom | Correction |
| --- | --- | --- |
| H5P.Blanks 1.14.37 | The focused heading after Check uses the English fallback even when the source supplies a Spanish translation. | Read the semantic field `a11yCheckingModeHeader` and retain the old fallback for existing content. |
| H5P.QuestionSet 1.21.13 | The completion live region joins the result heading and feedback and may repeat punctuation. | Join nonempty plain-text fragments with sentence boundaries. |

For administrators, use a staging copy of the two library directories. From their parent directory run `git apply --check /path/to/h5p-accessibility.patch`, then apply it to that copy. Deploy through the site's library maintenance process and refresh its H5P asset caches. Keep the original library files for rollback. Recheck both fixes after an upstream library update.

For acceptance, check an incorrect Spanish blank and inspect the focused heading. Repeat using the site's screen reader. Complete a two-question set at 2/3 and 3/3, check the visible points and listen to the completion announcement. Record the installed library versions and the actual wording. The content compiler supplies the Spanish points label independently of this patch.
