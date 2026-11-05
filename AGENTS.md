# Development rules

- Use English throughout the repository, including documentation, code comments, tests, examples, and commit messages. Generate activities in the language requested by the teacher.
- Keep changes within the requested scope. Preserve unrelated work and review the staged diff before committing.
- Use `.agents/skills/h5p-authoring/` as the single source for the skill. Both the MCP server and the distributed package must use it.
- When creating, reviewing or scripting batches of H5P activities, apply the h5p-authoring skill to the source template as well as individual items. For generated scientific figures, also apply typst-graphics. Keep reusable authoring guidance in the relevant skill when QA exposes a recurring mistake.
- When changing a skill, install the package outside the checkout. Verify that the MCP server can discover the skill and read every resource listed in its manifest. Check each resource against the manifest.
- When reporting H5P validation, distinguish package structure, Moodle import, playback, accessibility, and grade transfer. State which checks you performed.
- Follow Conventional Commits. Use `fix` for changes that correct a defect in the distributed product.
- Obtain explicit approval before publishing a package, extension, or release, or sending changes upstream.
