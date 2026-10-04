#!/usr/bin/env bash
set -euo pipefail

PSQL=(/opt/homebrew/opt/postgresql@18/bin/psql -v ON_ERROR_STOP=1 -h "${PGHOST:?}" -p "${PGPORT:?}" -d "${PGDATABASE:?}")

run_admin_insert() {
  "${PSQL[@]}" -c "set role qa_admin; set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001'; begin; $1; select pg_sleep(1); commit;" >/tmp/classfy-prospect-concurrency-owner.log &
  owner_pid=$!
  sleep 0.15
  set +e
  "${PSQL[@]}" -c "set role qa_admin; set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001'; $2" >/tmp/classfy-prospect-concurrency-contender.log 2>&1
  contender_status=$?
  set -e
  wait "$owner_pid"
  if [[ "$contender_status" -eq 0 ]]; then
    echo "concurrent duplicate unexpectedly succeeded" >&2
    exit 1
  fi
  grep -q "duplicate prospect" /tmp/classfy-prospect-concurrency-contender.log
}

run_admin_insert \
  "insert into public.prospects(channel_id,channel_name,channel_url) values ('race-id','Race ID owner','https://youtube.com/@race-id-owner')" \
  "insert into public.prospects(channel_id,channel_name,channel_url) values ('RACE-ID','Race ID contender','https://youtube.com/@race-id-contender')"

run_admin_insert \
  "insert into public.prospects(channel_id,channel_name,channel_url) values ('race-url-owner','Race URL owner','https://youtube.com/@race-url/')" \
  "insert into public.prospects(channel_id,channel_name,channel_url) values ('race-url-contender','Race URL contender','HTTPS://YOUTUBE.COM/@RACE-URL')"

echo "concurrent identity dedupe: passed"
