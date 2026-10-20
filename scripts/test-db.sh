#!/usr/bin/env bash
# Executa os testes de integração do banco contra um PostgreSQL REAL e EFÊMERO.
#
# 1. Cria um cluster temporário (initdb) em um diretório descartável.
# 2. Aplica o shim local do Supabase e todas as migrações, em ordem.
# 3. Roda `vitest --config vitest.db.config.ts` com TEST_DATABASE_URL.
# 4. Para o cluster e apaga o diretório, mesmo em caso de falha.
#
# Não se conecta a nenhum banco existente e não usa dados reais.
# Requer binários do PostgreSQL (initdb, pg_ctl, psql). Defina PG_BIN se não
# estiverem no PATH (ex.: PG_BIN=/usr/lib/postgresql/16/bin).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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

PORT="${PGTEST_PORT:-54329}"
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/ff-pgtest.XXXXXX")"
DATA="$WORKDIR/data"

# initdb/postgres não rodam como root: usa o usuário 'postgres' quando necessário.
RUN=()
if [[ "$(id -u)" == "0" ]]; then
  chown -R postgres "$WORKDIR"
  RUN=(runuser -u postgres --)
fi

cleanup() {
  "${RUN[@]}" "$PG_BIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

"${RUN[@]}" "$PG_BIN/initdb" -D "$DATA" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null
"${RUN[@]}" "$PG_BIN/pg_ctl" -D "$DATA" -l "$WORKDIR/postgres.log" -w \
  -o "-p $PORT -k $WORKDIR -c listen_addresses=127.0.0.1 -c timezone=UTC" start >/dev/null

PSQL=("$PG_BIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -d postgres -c "create database financas_test"

echo "→ Aplicando shim local do Supabase"
"${PSQL[@]}" -d financas_test -f "$ROOT/supabase/tests/local-supabase-shim.sql"
for migration in "$ROOT"/supabase/migrations/*.sql; do
  echo "→ Aplicando $(basename "$migration")"
  "${PSQL[@]}" -d financas_test -1 -f "$migration"
done

export TEST_DATABASE_URL="postgres://postgres@127.0.0.1:$PORT/financas_test"
cd "$ROOT"
npx vitest run --config vitest.db.config.ts "$@"
