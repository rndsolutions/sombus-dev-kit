#!/usr/bin/env bash
# The pinned upstream (upstream/som-1.0) must be byte-for-byte what SOURCE.md says:
# every file listed in SHA256SUMS matches, and nothing unlisted has been added.
set -euo pipefail
cd "$(dirname "$0")/../upstream/som-1.0"

shasum -a 256 --check --quiet SHA256SUMS

listed=$(sed 's/^[0-9a-f]*  //' SHA256SUMS | sort)
present=$(find . -type f ! -name SHA256SUMS ! -name SOURCE.md ! -path '*/__pycache__/*' | sort)
if [ "$listed" != "$present" ]; then
  echo "upstream/som-1.0 has files that SHA256SUMS doesn't list (or the reverse):" >&2
  diff <(echo "$listed") <(echo "$present") >&2 || true
  exit 1
fi
echo "upstream/som-1.0: $(echo "$listed" | wc -l | tr -d ' ') files match SHA256SUMS"
