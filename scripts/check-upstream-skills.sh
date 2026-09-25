#!/usr/bin/env bash
# Runs the skill library's own five validators (upstream/som-1.0/skills/scripts),
# against the pinned schema, exactly as upstream's README says to run them.
# Later, the same validators also run over configs/ in this repo.
set -euo pipefail
cd "$(dirname "$0")/../upstream/som-1.0/skills"
export PYTHONDONTWRITEBYTECODE=1

for f in skills/*.md; do
  python3 scripts/validate_som_skill.py "$f" > /dev/null || { echo "validate_som_skill.py failed: $f" >&2; exit 1; }
done
echo "validate_som_skill.py: $(ls skills/*.md | wc -l | tr -d ' ') skills pass"

python3 scripts/check_library.py skills/
python3 scripts/check_paths.py skills/
python3 scripts/build_lookup_table.py . --check
python3 scripts/check_cover_claims.py .
