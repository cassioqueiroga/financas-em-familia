/**
 * Prepara o banco do backend LOCAL de desenvolvimento (idempotente):
 * aplica o shim do Supabase e as migrações ainda não aplicadas, cria dois
 * usuários FICTÍCIOS e grava a configuração do frontend para o modo
 * `localdev`. Nunca se conecta a bancos remotos.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { hashPassword, signJwt } from './crypto.ts';

const ROOT = process.env.DEV_ROOT ?? '';
const DATABASE_URL = process.env.DEV_DATABASE_URL ?? '';
const STATE = join(ROOT, '.local-dev');
const API_PORT = Number(process.env.DEV_API_PORT ?? 54321);

if (!ROOT || !/^postgres:\/\/[^@]+@127\.0\.0\.1:\d+\//.test(DATABASE_URL)) {
  console.error('Use scripts/dev-backend/start.sh (o banco precisa ser local, em 127.0.0.1).');
  process.exit(2);
}

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();

await db.query('create schema if not exists dev_meta');
await db.query('create table if not exists dev_meta.applied (name text primary key, applied_at timestamptz not null default now())');
const applied = new Set((await db.query<{ name: string }>('select name from dev_meta.applied')).rows.map((r) => r.name));

const files = [
  join(ROOT, 'supabase/tests/local-supabase-shim.sql'),
  ...readdirSync(join(ROOT, 'supabase/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => join(ROOT, 'supabase/migrations', f)),
];
for (const file of files) {
  const name = file.slice(ROOT.length + 1);
  if (applied.has(name)) continue;
  console.warn(`→ Aplicando ${name}`);
  await db.query('begin');
  try {
    await db.query(readFileSync(file, 'utf8'));
    await db.query('insert into dev_meta.applied (name) values ($1)', [name]);
    await db.query('commit');
  } catch (err) {
    await db.query('rollback');
    throw err;
  }
}

// Credenciais locais: esquema inacessível para anon/authenticated.
await db.query(`
  create schema if not exists dev_auth;
  revoke all on schema dev_auth from public, anon, authenticated;
  create table if not exists dev_auth.credentials (
    user_id uuid primary key references auth.users (id) on delete cascade,
    email text not null unique,
    password_hash text not null,
    created_at timestamptz not null default now()
  );
  revoke all on dev_auth.credentials from public, anon, authenticated;
`);

const secretFile = join(STATE, 'jwt-secret');
if (!existsSync(secretFile)) writeFileSync(secretFile, randomBytes(48).toString('base64url'), { mode: 0o600 });
const secret = readFileSync(secretFile, 'utf8').trim();

const credFile = join(STATE, 'credenciais-de-teste.txt');
const users = [
  { email: 'chefe@exemplo.test', name: 'Chefe (teste)' },
  { email: 'esposa@exemplo.test', name: 'Esposa (teste)' },
];
const created: string[] = [];
for (const u of users) {
  const exists = await db.query('select 1 from dev_auth.credentials where email = $1', [u.email]);
  if (exists.rowCount) continue;
  const password = process.env.DEV_PASSWORD ?? randomBytes(9).toString('base64url');
  const { rows } = await db.query<{ id: string }>('insert into auth.users (email) values ($1) returning id', [u.email]);
  await db.query('insert into dev_auth.credentials (user_id, email, password_hash) values ($1, $2, $3)', [
    rows[0]!.id,
    u.email,
    hashPassword(password),
  ]);
  await db.query('update public.profiles set display_name = $2 where id = $1', [rows[0]!.id, u.name]);
  created.push(`${u.email}  senha: ${password}`);
}
if (created.length) {
  const previous = existsSync(credFile) ? readFileSync(credFile, 'utf8') : '';
  writeFileSync(credFile, `${previous}${created.join('\n')}\n`, { mode: 0o600 });
}

const anonKey = signJwt({ role: 'anon', iss: 'financas-em-familia-dev', iat: Math.floor(Date.now() / 1000) }, secret);
writeFileSync(
  join(ROOT, '.env.localdev.local'),
  [
    '# Gerado por scripts/dev-backend/setup.ts — backend LOCAL de desenvolvimento (não é o Supabase).',
    'VITE_APP_ENV=development',
    `VITE_SUPABASE_URL=http://127.0.0.1:${API_PORT}`,
    `VITE_SUPABASE_ANON_KEY=${anonKey}`,
    '',
  ].join('\n'),
  { mode: 0o600 },
);

await db.end();
console.warn(`Banco local pronto. Usuários fictícios em ${credFile}`);
