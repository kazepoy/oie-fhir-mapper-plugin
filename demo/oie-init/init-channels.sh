#!/bin/sh
# Restore OIE from the mounted initialization directory:
# 1. Restore the OIE server configuration (overwriting existing settings, including FHIR contexts).
# 2. Import channels (data/channels/) and groups (data/groups/) in OIE export format.
# 3. Deploy channels and mark the first login as complete.
set -eu

OIE_URL="${OIE_URL:-https://oie-app:8443}"
OIE_USER="${OIE_USER:-admin}"
OIE_PASSWORD="${OIE_PASSWORD:-admin}"
OIE_SKIP_FIRST_LOGIN="${OIE_SKIP_FIRST_LOGIN:-true}"
OIE_SEED_MESSAGES="${OIE_SEED_MESSAGES:-true}"
INIT_DIR="${OIE_INIT_DIR:-/oie-init}"
DATA_DIR="$INIT_DIR/data"
CONFIG_FILE="$DATA_DIR/configuration.xml"
CHANNELS_DIR="$DATA_DIR/channels"
GROUPS_DIR="$DATA_DIR/groups"
EMPTY_SET_FILE=/tmp/oie-empty-set.xml
RESPONSE_FILE=/tmp/oie-response.txt

fail() {
  echo "  -> ERROR: $*" >&2
  exit 1
}

# request METHOD PATH [FILE [TYPE]]: authenticated REST call (XML body by default).
request() {
  set -- "$1" "$2" "${3:-}" "${4:-application/xml}"
  if [ -n "$3" ]; then
    curl --insecure --noproxy '*' --silent --show-error --max-time 300 \
      --user "$OIE_USER:$OIE_PASSWORD" --header 'X-Requested-With: OpenAPI' \
      --header "Content-Type: $4" --data-binary "@$3" \
      --request "$1" --output "$RESPONSE_FILE" --write-out '%{http_code}' "$OIE_URL/api$2" || fail "Request failed: $1 $2"
  else
    curl --insecure --noproxy '*' --silent --show-error --max-time 300 \
      --user "$OIE_USER:$OIE_PASSWORD" --header 'X-Requested-With: OpenAPI' \
      --request "$1" --output "$RESPONSE_FILE" --write-out '%{http_code}' "$OIE_URL/api$2" || fail "Request failed: $1 $2"
  fi
}

# api METHOD PATH [FILE [TYPE]]: fail on non-2xx HTTP or a false boolean response.
api() {
  status=$(request "$@")
  case "$status" in
    2??) ;;
    *) fail "HTTP $status for $1 $2 : $(cat "$RESPONSE_FILE")" ;;
  esac
  if grep -qE '<boolean>false</boolean>|"boolean" *: *false|^false$' "$RESPONSE_FILE"; then
    fail "OIE rejected $1 $2 : $(cat "$RESPONSE_FILE")"
  fi
}

xml_value() {
  sed -n "s:.*<$1>\(.*\)</$1>.*:\1:p" "$2" | head -n 1
}

echo "=== Restoring OIE ($OIE_URL) ==="

# 1. Restore OIE configuration (overwriting existing channels, groups, tags and settings).
[ -f "$CONFIG_FILE" ] || fail "Configuration file not found: $CONFIG_FILE"
echo "Importing OIE server configuration..."
api PUT "/server/configuration?deploy=true&overwriteConfigMap=true" "$CONFIG_FILE"

# 2. Import channels in OIE export format.
count=0
printf '<set>\n' > /tmp/oie-deploy-ids.xml
for file in "$CHANNELS_DIR"/*.xml; do
  [ -f "$file" ] || continue
  id=$(xml_value id "$file")
  name=$(xml_value name "$file")
  [ -n "$id" ] || fail "<id> not found in $file"
  api PUT "/channels/$id?override=true" "$file"
  printf '  <string>%s</string>\n' "$id" >> /tmp/oie-deploy-ids.xml
  count=$((count + 1))
  echo "Channel imported: $name"
done
printf '</set>\n' >> /tmp/oie-deploy-ids.xml

api GET /channels
if grep -Fq "This channel is invalid." "$RESPONSE_FILE"; then
  fail "At least one channel is invalid after import. Check extensions and step deserialization."
fi

# 3. Import channel groups.
printf '<set/>\n' > "$EMPTY_SET_FILE"
{
  printf '<set>\n'
  for file in "$GROUPS_DIR"/*.xml; do
    [ -f "$file" ] || continue
    awk '$0 !~ /^<\/?set[^>]*>/ { print }' "$file"
  done
  printf '</set>\n'
} > /tmp/oie-groups.xml

if grep -Fq "<channelGroup" /tmp/oie-groups.xml; then
  status=$(curl --insecure --noproxy '*' --silent --show-error --max-time 300 \
    --user "$OIE_USER:$OIE_PASSWORD" --header 'X-Requested-With: OpenAPI' \
    --form "channelGroups=@/tmp/oie-groups.xml;type=application/xml" \
    --form "removedChannelGroupIds=@$EMPTY_SET_FILE;type=application/xml" \
    --output "$RESPONSE_FILE" --write-out '%{http_code}' \
    "$OIE_URL/api/channelgroups/_bulkUpdate?override=true") || fail "Channel group update failed"
  case "$status" in
    2??) ;;
    *) fail "HTTP $status for /channelgroups/_bulkUpdate : $(cat "$RESPONSE_FILE")" ;;
  esac
  if grep -qE '<boolean>false</boolean>|"boolean" *: *false|^false$' "$RESPONSE_FILE"; then
    fail "Groups rejected: $(cat "$RESPONSE_FILE")"
  fi
  echo "Groups installed"
fi

# 3b. Apply channel tags after channels exist on the server.
awk '/<channelTags>/{in_tags=1; print "<set>"; next} /<\/channelTags>/{in_tags=0; print "</set>"; next} in_tags{print}' "$CONFIG_FILE" > /tmp/oie-channel-tags.xml
if grep -Fq "<channelTag" /tmp/oie-channel-tags.xml; then
  api PUT /server/channelTags /tmp/oie-channel-tags.xml
  echo "Channel tags installed"
fi

# 4. Deploy imported channels together.
if [ "$count" -gt 0 ]; then
  echo "Deploying $count channel(s)..."
  api POST "/channels/_deploy?returnErrors=true" /tmp/oie-deploy-ids.xml
  if [ -s "$RESPONSE_FILE" ]; then
    fail "Deployment rejected: $(cat "$RESPONSE_FILE")"
  fi
fi

# 5. Mark the first login as complete (skip the password-change wizard).
if [ "$OIE_SKIP_FIRST_LOGIN" = true ]; then
  request GET /users/current > /dev/null
  user_id=$(xml_value id "$RESPONSE_FILE")
  [ -n "$user_id" ] || fail "Account ID not found for $OIE_USER"
  printf false > /tmp/firstlogin.txt
  api PUT "/users/$user_id/preferences/firstlogin" /tmp/firstlogin.txt text/plain
  echo "First login marked complete for $OIE_USER"
fi

# 6. Seed one sample message per active channel (when examples.json is present).
if [ "$OIE_SEED_MESSAGES" = true ] && [ -f "$INIT_DIR/examples.json" ]; then
  OIE_HOST=$(printf '%s' "$OIE_URL" | sed -E 's|^https?://([^:/]+).*|\1|')
  seed_message() {
    port="$1"
    route="$2"
    ctype="$3"
    file="$INIT_DIR/$4"
    [ -f "$file" ] || return 0
    code=$(curl --noproxy '*' --silent --show-error --max-time 60 \
      --header "Content-Type: $ctype" --data-binary "@$file" \
      --output /dev/null --write-out '%{http_code}' \
      "http://$OIE_HOST:$port$route/" || echo "000")
    echo "Seeded $port$route/ ($4): HTTP $code"
  }
  echo "Seeding sample messages..."
  seed_message 10804 "/simple-fml" "text/plain; charset=UTF-8" "data/samples/adt-a28.er7"
  seed_message 10805 "/fml-terminology" "text/plain; charset=UTF-8" "data/samples/adt-a28.er7"
  seed_message 10800 "/oru-patient" "text/plain; charset=UTF-8" "data/samples/oru-r01.er7"
  seed_message 10801 "/pid-fr-core-ins" "text/plain; charset=UTF-8" "data/samples/04-hl7v2-pid-fr-core-ins/input.er7"
  seed_message 10802 "/fhir-patient" "application/fhir+json; charset=UTF-8" "data/samples/05-fhir-patient-normalization/input.json"
  seed_message 10803 "/commande-json" "application/json; charset=UTF-8" "data/samples/06-json-order-to-dispatch/input.json"
  seed_message 10814 "/permission-r5" "text/csv; charset=UTF-8" "data/samples/restored/permissions-r5.csv"
  seed_message 10815 "/patient-fml-ig" "text/plain; charset=UTF-8" "data/samples/restored/oru-patient.er7"
  seed_message 10806 "/csv-patients-collection" "text/csv; charset=UTF-8" "data/samples/restored/business-patients.csv"
  seed_message 10807 "/oru" "text/plain; charset=UTF-8" "data/samples/restored/oru-laboratory.er7"
  seed_message 10808 "/devdays-patient" "text/plain; charset=UTF-8" "data/samples/adt-a28.er7"
fi

echo "=== Done: $count channel(s) imported and deployed ==="
