# executors/

One folder per upstream library skill, named after it (`raise-flag-on-match/`, …). Each holds:
- the executor, implementing exactly what [`upstream/som-1.0/skills/skills/<skill>.md`](../upstream/som-1.0/skills/skills) specifies: the config surface, evaluation and output;
- its tests;
- a README mapping each section of the upstream file to the code.

Warnings carry the upstream identity: `skill_id` `smart-stories/<skill>`, `skill_version` `0.2.2`.

First: `raise-flag-on-match`, `gate-by-scope`, `flag-on-mismatch`.
