import { randomUUID } from 'node:crypto';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error('TEST_DATABASE_URL ausente. Execute os testes de banco com `npm run test:db`.');
}

export const pool = new pg.Pool({ connectionString: url, max: 10 });

export type Db = pg.PoolClient;

/** Cria um usuário em auth.users (como o Supabase Auth faria). */
export async function createUser(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    'insert into auth.users (email) values ($1) returning id',
    [`teste-${randomUUID()}@exemplo.test`],
  );
  return rows[0]!.id;
}

async function withRole<T>(role: 'anon' | 'authenticated', userId: string | null, fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`set local role ${role}`);
    if (userId) await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

/** Executa como usuário autenticado (papel `authenticated` + auth.uid()). */
export const asUser = <T>(userId: string, fn: (db: Db) => Promise<T>) => withRole('authenticated', userId, fn);

/** Executa como visitante anônimo (papel `anon`). */
export const asAnon = <T>(fn: (db: Db) => Promise<T>) => withRole('anon', null, fn);

export async function createHousehold(
  userId: string,
  name = 'Espaço de teste',
  kind: 'personal' | 'family' = 'family',
  key: string = randomUUID(),
) {
  return asUser(userId, async (db) => {
    const { rows } = await db.query('select * from public.create_household($1, $2, $3)', [name, kind, key]);
    return rows[0] as { id: string; name: string; kind: string; version: number; created_by: string };
  });
}

/** Captura o SQLSTATE de uma operação que deve falhar. */
export async function sqlState(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (err) {
    return (err as { code?: string }).code;
  }
}
