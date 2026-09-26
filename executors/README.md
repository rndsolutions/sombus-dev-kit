# executors/

One folder per upstream library skill, named after it. Each holds:
- the executor, implementing exactly what [`upstream/som-1.0/skills/skills/<skill>.md`](../upstream/som-1.0/skills/skills) specifies: the config surface, evaluation and output;
- its tests, including the skill file's eval set where it applies;
- a README mapping each section of the upstream file to the code, and saying what isn't done yet;
- a runner to try it against your workspace.

Warnings carry the upstream identity: `skill_id` `smart-stories/<skill>`, `skill_version` `0.2.2`. Where the
library leaves a question open, executors follow and cite RND's [positions](../spec/README.md).

| Skill | Executor |
|---|---|
| [`raise-flag-on-match`](raise-flag-on-match/) | Available: passes every runnable case of the skill harness; clearance not yet |
| `gate-by-scope`, `flag-on-mismatch` | Next |
| The rest of the library | Later. See the [roadmap](../README.md#roadmap) |
