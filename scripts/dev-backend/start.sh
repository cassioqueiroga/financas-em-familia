#!/usr/bin/env bash
# Sobe o backend LOCAL de desenvolvimento: PostgreSQL persistente em
# .local-dev/pgdata (127.0.0.1:54322) + API compatível com o subconjunto do
# Supabase usado pelo app (127.0.0.1:54321). Somente dados fictícios.
#
#   npm run dev:backend          # em um terminal
#   npm run dev:local            # em outro terminal (Vite no modo localdev)
#
# Para apagar tudo e recomeçar: npm run dev:backend -- --reset
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE="$ROOT/.local-dev"
DATA="$STATE/pgdata"
PG_PORT="${DEV_PG_PORT:-54322}"
export DEV_API_PORT="${DEV_API_PORT:-54321}"

PG_BIN="${PG_BIN:-}"
if [[ -z "$PG_BIN" ]]; then
  if command -v initdb >/dev/null 2>&1; then
    PG_BIN="$(dirname "$(command -v initdb)")"
  else
    PG_BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
  fi
fi
if [[ -z "$PG_BIN" || ! -x "$PG_BIN/initdb" ]]; then
  echo "ERRO: binários do PostgreSQL não encontrados. Defina PG_BIN." >&2
  exit 2
fi

RUN=()
if [[ "$(id -u)" == "0" ]]; then
  RUN=(runuser -u postgres --)
fi

if [[ "${1:-}" == "--reset" ]]; then
  "${RUN[@]}" "$PG_BIN/pg_ctl" -D "$DATA" -m fast stop >/dev/null 2>&1 || true
  rm -rf "$STATE" "$ROOT/.env.localdev.local"
  echo "Backend local apagado."
fi

mkdir -p "$STATE"
chmod 700 "$STATE"
[[ "$(id -u)" == "0" ]] && chown postgres "$STATE"
if [[ ! -f "$DATA/PG_VERSION" ]]; then
  mkdir -p "$DATA"
  [[ "$(id -u)" == "0" ]] && chown -R postgres "$DATA"
  "${RUN[@]}" "$PG_BIN/initdb" -D "$DATA" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null
fi
[[ "$(id -u)" == "0" ]] && chown -R postgres "$DATA"

"${RUN[@]}" "$PG_BIN/pg_ctl" -D "$DATA" -l "$DATA/postgres.log" -w \
  -o "-p $PG_PORT -k $DATA -c listen_addresses=127.0.0.1 -c timezone=UTC" start >/dev/null

stop_pg() {
  "${RUN[@]}" "$PG_BIN/pg_ctl" -D "$DATA" -m fast stop >/dev/null 2>&1 || true
}
trap stop_pg EXIT

PSQL=("$PG_BIN/psql" -h 127.0.0.1 -p "$PG_PORT" -U postgres -v ON_ERROR_STOP=1 -q -X)
if ! "${PSQL[@]}" -d postgres -tAc "select 1 from pg_database where datname = 'financas_dev'" | grep -q 1; then
  "${PSQL[@]}" -d postgres -c "create database financas_dev"
fi

export DEV_ROOT="$ROOT"
export DEV_DATABASE_URL="postgres://postgres@127.0.0.1:$PG_PORT/financas_dev"
node --experimental-strip-types --no-warnings "$ROOT/scripts/dev-backend/setup.ts"
DEV_JWT_SECRET="$(cat "$STATE/jwt-secret")"
export DEV_JWT_SECRET
node --experimental-strip-types --no-warnings "$ROOT/scripts/dev-backend/server.ts"
