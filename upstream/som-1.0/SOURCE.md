# Pinned upstream: Story Object Model 1.0 and skill library 0.2.2

- **Source:** https://github.com/storyobjectmodel/som
- **Commit:** `7297fef9adc6d14a74bdd7550c78decaa099a1ad` (12 Sep 2026, SOM 1.0 release). This is the same commit `som-bus-reference` pins.
- **Copied:**
  - `schema/`: the standard, normative;
  - `examples/`: the positive and negative corpus;
  - `skills/`: som-skill-library 0.2.2, plus its docs, lookup table and validators;
  - `tools/`: the upstream message validators;
  - `LICENSE` and `LICENSE-SPEC`.
- **Licence:** Apache 2.0 for the schemas, examples, tools and skills (`LICENSE`); CC BY 4.0 for the specification prose (`LICENSE-SPEC`). © the SOM authors, redistributed under those terms.
- **Integrity:** `SHA256SUMS`, checked in CI by `scripts/verify-upstream.sh`.

**Don't edit these files.** Upstream's governance applies: the schema is the source of truth, and there is one copy of it. Where a skill's prose and the schema disagree, the schema is right, and the fix belongs upstream as a pull request (see `CONTRIBUTING.md`).

To move to a new upstream release:
1. Re-copy these folders from the new tag.
2. Regenerate `SHA256SUMS`.
3. Update this file.
4. Run CI.

A new skill library version is a new suite id (e.g. `som-1.0.0+lib-0.2.3`), never an edit of this one.

The layout keeps `schema/` next to `skills/`, as upstream does, because `skills/scripts/check_paths.py` resolves `../schema/story-context.schema.json` relative to itself.
