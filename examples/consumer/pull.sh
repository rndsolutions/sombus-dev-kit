#!/usr/bin/env bash
# Pull your consumer connection's queue from SOM Managed Bus, with nothing but curl and jq: the
# quickest way to see messages arrive, before you write a consumer. At a terminal it asks for the
# connection's details, offering any SOMBUS_* value already set as the default; the secret is read
# without echoing, and never stored or printed. Without a terminal it takes them from the environment.
#
#   examples/consumer/pull.sh                  # asks for workspace, connection id and secret
#   examples/consumer/pull.sh --staging        # the staging environment instead of the Sandbox
#   examples/consumer/pull.sh --no-ack         # look without removing: messages come back after --visibility seconds
#   examples/consumer/pull.sh --once --full    # one batch, each message's whole envelope
#
# The same settings as the TypeScript examples (examples/README.md), as defaults when set:
#   SOMBUS_BASE_URL, SOMBUS_WORKSPACE, SOMBUS_CLIENT_ID, SOMBUS_CLIENT_SECRET
#
# The workspace is the one your consumer connection is in: yours, or the house's for a connection
# you made in a publisher's house. The client id is the connection's id; the secret comes from the
# portal (Get client secret), shown once.
set -euo pipefail

usage() { awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit "${1:-0}"; }

BASE_URL="${SOMBUS_BASE_URL:-https://api.sombus.rnd-solutions.net/v1/}"
ACK=1 ONCE=0 FULL=0 MAX=10 WAIT=20 VISIBILITY=60
while [ $# -gt 0 ]; do
  case "$1" in
    --staging) BASE_URL="https://api.staging.sombus.rnd-solutions.net/v1/" ;;
    --base-url) BASE_URL="$2"; shift ;;
    --no-ack) ACK=0 ;;
    --once) ONCE=1 ;;
    --full) FULL=1 ;;
    --max) MAX="$2"; shift ;;
    --wait) WAIT="$2"; shift ;;
    --visibility) VISIBILITY="$2"; shift ;;
    -h|--help) usage ;;
    *) echo "Unknown option: $1" >&2; usage 2 ;;
  esac
  shift
done
BASE_URL="${BASE_URL%/}"

for tool in curl jq; do
  command -v "$tool" >/dev/null || { echo "This script needs $tool." >&2; exit 2; }
done

ask() { # ask <variable> <prompt> [secret]: at a terminal always, the environment's value as the default
  local current="${!1:-}" answer hint
  if [ ! -t 0 ]; then
    [ -n "$current" ] || { echo "Set $1 (no terminal to ask on)." >&2; exit 2; }
    return
  fi
  if [ "${3:-}" = secret ]; then
    hint=${current:+" [set in the environment: Enter keeps it]"}
    read -r -s -p "$2$hint: " answer; echo >&2
  else
    hint=${current:+" [$current]"}
    read -r -p "$2$hint: " answer
  fi
  printf -v "$1" '%s' "${answer:-$current}"
  [ -n "${!1}" ] || { echo "$1 is required." >&2; exit 2; }
}
ask SOMBUS_WORKSPACE "Workspace id (w…) the connection is in"
ask SOMBUS_CLIENT_ID "Consumer connection id (c…)"
ask SOMBUS_CLIENT_SECRET "Connection secret (hidden)" secret

QUEUE="$BASE_URL/tenants/$SOMBUS_WORKSPACE/consumers/$SOMBUS_CLIENT_ID"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

TOKEN=""
token() { # a token for the connection; the secret goes on stdin, never on the command line
  local status user="$SOMBUS_CLIENT_ID:$SOMBUS_CLIENT_SECRET"
  user=${user//\\/\\\\}; user=${user//\"/\\\"}   # curl config quoting
  status=$(printf 'user = "%s"\n' "$user" \
    | curl -s -o "$TMP/token.json" -w '%{http_code}' -K - -d grant_type=client_credentials "$BASE_URL/oauth/token")
  if [ "$status" != 200 ]; then
    echo "The token service said $status: $(jq -c . "$TMP/token.json" 2>/dev/null || cat "$TMP/token.json")" >&2
    echo "Check the connection id and secret, and the environment ($BASE_URL)." >&2
    exit 1
  fi
  TOKEN=$(jq -r .access_token "$TMP/token.json")
}

call() { # call <method> <path> [body file] → the answer in $TMP/answer.json, the status on stdout
  local args=(-s -o "$TMP/answer.json" -w '%{http_code}' -X "$1" -H "Authorization: Bearer $TOKEN")
  [ -n "${3:-}" ] && args+=(-H 'Content-Type: application/json' --data-binary "@$3")
  curl "${args[@]}" "$QUEUE/$2"
}

token
echo "Pulling connection $SOMBUS_CLIENT_ID in workspace $SOMBUS_WORKSPACE at $BASE_URL (Ctrl-C to stop)" >&2
total=0
while :; do
  status=$(call GET "messages?max=$MAX&wait=$WAIT&visibility=$VISIBILITY")
  if [ "$status" = 401 ]; then token; continue; fi   # the hour is up: a new token, and pull again
  if [ "$status" != 200 ]; then
    echo "Pull said $status: $(jq -c . "$TMP/answer.json" 2>/dev/null || cat "$TMP/answer.json")" >&2
    [ "$status" = 403 ] && echo "Is the workspace the one the connection is in, and is the connection active?" >&2
    exit 1
  fi
  n=$(jq '.messages | length' "$TMP/answer.json")
  if [ "$n" = 0 ]; then
    echo "No messages within ${WAIT}s. $total received so far." >&2
    [ "$ONCE" = 1 ] && break
    continue
  fi
  total=$((total + n))
  if [ "$FULL" = 1 ]; then
    jq '.messages[] | del(.receipt_handle)' "$TMP/answer.json"
  else
    jq -r '.messages[] | [.enqueued_at, .message_type, .producer_id, (.envelope.payload.story_id // "-"),
      ("seq " + ((.envelope.payload.sequence_number // "-") | tostring)), ("delivery " + (.receive_count | tostring))] | @tsv' \
      "$TMP/answer.json"
  fi
  if [ "$ACK" = 1 ]; then
    jq '{receipt_handles: [.messages[].receipt_handle]}' "$TMP/answer.json" > "$TMP/ack.json"
    status=$(call POST ack "$TMP/ack.json")
    failed=$(jq '.failed | length' "$TMP/answer.json" 2>/dev/null || echo "?")
    [ "$status" = 200 ] && [ "$failed" = 0 ] || echo "Acknowledge said $status, $failed failed: $(jq -c . "$TMP/answer.json")" >&2
  fi
  [ "$ONCE" = 1 ] && break
done
