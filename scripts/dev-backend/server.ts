/**
 * Backend LOCAL de desenvolvimento — NÃO é o Supabase e NÃO deve ser usado
 * com dados reais nem exposto na rede.
 *
 * Existe porque não há projeto Supabase autorizado e o ambiente atual não
 * consegue baixar a stack oficial (Docker). Ele permite executar a aplicação
 * de ponta a ponta contra um PostgreSQL REAL, com as MESMAS migrações, papéis
 * (`anon`/`authenticated`), RLS e RPCs usados em produção. Implementa só o
 * subconjunto das APIs do Supabase que o frontend e o roteiro E2E usam:
 *
 *   Auth (GoTrue):  POST /auth/v1/token?grant_type=password|refresh_token,
 *                   GET /auth/v1/user, POST /auth/v1/logout
 *   REST (PostgREST): GET/POST/PATCH/DELETE /rest/v1/<tabela> com filtros
 *                   simples (eq, neq, gt, gte, lt, lte, is, in) e order;
 *                   POST /rest/v1/rpc/<função>
 *
 * Cada requisição roda numa transação com `set local role` e as claims do
 * JWT, exatamente como o PostgREST; a autorização continua 100% no banco.
 * Chaves `service_role` são recusadas. Escuta apenas em 127.0.0.1.
 */
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import pg from 'pg';
import { checkPassword, signJwt as signJwtWith, verifyJwt as verifyJwtWith, type Claims } from './crypto.ts';

const DATABASE_URL = process.env.DEV_DATABASE_URL ?? '';
const JWT_SECRET = process.env.DEV_JWT_SECRET ?? '';
const PORT = Number(process.env.DEV_API_PORT ?? 54321);
const ACCESS_TTL = 3600;
const REFRESH_TTL = 30 * 24 * 3600;
const MAX_BODY = 5 * 1024 * 1024;

if (!DATABASE_URL || JWT_SECRET.length < 32) {
  console.error('DEV_DATABASE_URL e DEV_JWT_SECRET (>= 32 caracteres) são obrigatórios. Use scripts/dev-backend/start.sh.');
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 10 });
const IDENT = /^[a-z_][a-z0-9_]*$/;

const verifyJwt = (token: string) => verifyJwtWith(token, JWT_SECRET);
const signJwt = (payload: Record<string, unknown>) => signJwtWith(payload, JWT_SECRET);

// ---------------------------------------------------------------------------
// HTTP utilitários
// ---------------------------------------------------------------------------
class HttpError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(String(body.message ?? body.msg ?? 'erro'));
    this.status = status;
    this.body = body;
  }
}

function send(res: ServerResponse, status: number, body?: unknown, extra: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extra });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, { code: 'PGRST413', message: 'Corpo da requisição grande demais' });
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, { code: 'PGRST102', message: 'JSON inválido' });
  }
}

function cors(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin ?? '';
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'authorization,apikey,content-type,x-client-info,accept-profile,content-profile,prefer,x-supabase-api-version,range',
    );
    res.setHeader('Access-Control-Expose-Headers', 'content-range,x-supabase-api-version');
  }
}

/** Claims efetivas da requisição: Authorization Bearer ou, na falta, a apikey. */
function requestClaims(req: IncomingMessage): Claims {
  const auth = req.headers.authorization;
  const token = auth?.toLowerCase().startsWith('bearer ') ? auth.slice(7) : String(req.headers.apikey ?? '');
  const claims = verifyJwt(token);
  if (!claims) throw new HttpError(401, { code: 'PGRST301', message: 'JWT inválido ou expirado' });
  if (claims.role !== 'anon' && claims.role !== 'authenticated') {
    throw new HttpError(401, { code: 'PGRST301', message: 'Papel não permitido neste backend local' });
  }
  if (claims.typ === 'refresh') throw new HttpError(401, { code: 'PGRST301', message: 'Token de atualização não é aceito na API' });
  return claims;
}

// ---------------------------------------------------------------------------
// Execução no banco como o PostgREST faria
// ---------------------------------------------------------------------------
async function asRole<T>(claims: Claims, fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('begin');
    await db.query(`set local role ${claims.role === 'authenticated' ? 'authenticated' : 'anon'}`);
    await db.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)", [
      JSON.stringify(claims),
      claims.sub ?? '',
    ]);
    const out = await fn(db);
    await db.query('commit');
    return out;
  } catch (err) {
    await db.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    db.release();
  }
}

function pgErrorToHttp(err: unknown, claims: Claims | null): HttpError {
  if (err instanceof HttpError) return err;
  const e = err as { code?: string; message?: string; detail?: string; hint?: string };
  const code = e.code ?? 'XX000';
  const status =
    code === '42501' ? (claims?.role === 'authenticated' ? 403 : 401)
    : code === '23505' ? 409
    : code === 'P0002' ? 404
    : code === '42883' || code === '42P01' ? 404
    : code.startsWith('22') || code.startsWith('23') ? 400
    : code === '40001' ? 409
    : 500;
  if (status === 500) console.error('Erro interno do backend local', { code });
  return new HttpError(status, { code, message: e.message ?? 'erro', details: e.detail ?? null, hint: e.hint ?? null });
}

interface ProcInfo {
  args: { name: string; type: string }[];
  retset: boolean;
  composite: boolean;
  isVoid: boolean;
}
const procCache = new Map<string, ProcInfo>();

async function procInfo(name: string): Promise<ProcInfo> {
  const cached = procCache.get(name);
  if (cached) return cached;
  const { rows } = await pool.query(
    `select p.proretset, t.typtype, t.typname, p.proargnames, p.proargmodes::text[] as proargmodes,
            array(select format_type(x, null) from unnest(p.proargtypes) x) as in_types
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type t on t.oid = p.prorettype
     where n.nspname = 'public' and p.proname = $1`,
    [name],
  );
  if (rows.length !== 1) throw new HttpError(404, { code: 'PGRST202', message: `Função ${name} não encontrada` });
  const r = rows[0] as { proretset: boolean; typtype: string; typname: string; proargnames: string[] | null; proargmodes: string[] | null; in_types: string[] };
  const names = r.proargnames ?? [];
  const modes = r.proargmodes ?? names.map(() => 'i');
  const inNames = names.filter((_, i) => modes[i] === 'i' || modes[i] === 'b');
  const info: ProcInfo = {
    args: r.in_types.map((type, i) => ({ name: inNames[i] ?? `$${i}`, type })),
    retset: r.proretset,
    composite: r.typtype === 'c',
    isVoid: r.typname === 'void',
  };
  procCache.set(name, info);
  return info;
}

function toParam(value: unknown, type: string): unknown {
  if (value === null || value === undefined) return null;
  if (type === 'json' || type === 'jsonb') return JSON.stringify(value);
  if (type.endsWith('[]')) return Array.isArray(value) ? value : value;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

async function callRpc(name: string, body: unknown, claims: Claims) {
  if (!IDENT.test(name)) throw new HttpError(404, { code: 'PGRST202', message: 'Função inválida' });
  const info = await procInfo(name);
  const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const params: unknown[] = [];
  const parts: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    const arg = info.args.find((a) => a.name === key);
    if (!arg) throw new HttpError(404, { code: 'PGRST202', message: `Parâmetro ${key} desconhecido em ${name}` });
    params.push(toParam(value, arg.type));
    parts.push(`${key} => $${params.length}::${arg.type}`);
  }
  const call = `public.${name}(${parts.join(', ')})`;
  return asRole(claims, async (db) => {
    if (info.isVoid) {
      await db.query(`select ${call}`, params);
      return null;
    }
    if (info.retset) {
      const { rows } = await db.query(`select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) as result from ${call} r`, params);
      return rows[0].result;
    }
    if (info.composite) {
      const { rows } = await db.query(`select case when r is null then null else to_jsonb(r) end as result from ${call} r`, params);
      return rows[0]?.result ?? null;
    }
    const { rows } = await db.query(`select to_jsonb(${call}) as result`, params);
    return rows[0].result;
  });
}

const OPS: Record<string, string> = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };
const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'columns', 'on_conflict']);

function buildWhere(query: URLSearchParams, params: unknown[]): string {
  const clauses: string[] = [];
  for (const [col, raw] of query) {
    if (RESERVED.has(col)) continue;
    if (!IDENT.test(col)) throw new HttpError(400, { code: 'PGRST100', message: `Coluna inválida: ${col}` });
    const dot = raw.indexOf('.');
    const op = raw.slice(0, dot);
    const value = raw.slice(dot + 1);
    if (op in OPS) {
      params.push(value);
      clauses.push(`${col} ${OPS[op]} $${params.length}`);
    } else if (op === 'is' && ['null', 'true', 'false'].includes(value)) {
      clauses.push(`${col} is ${value}`);
    } else if (op === 'in' && /^\(.*\)$/.test(value)) {
      params.push(value.slice(1, -1).split(',').map((v) => v.replace(/^"|"$/g, '')));
      clauses.push(`${col}::text = any($${params.length}::text[])`);
    } else {
      throw new HttpError(400, { code: 'PGRST100', message: `Operador não suportado neste backend local: ${op}` });
    }
  }
  return clauses.length ? `where ${clauses.join(' and ')}` : '';
}

function columnsList(select: string | null): string {
  if (!select || select === '*') return '*';
  const cols = select.split(',').map((c) => c.trim());
  if (!cols.every((c) => IDENT.test(c))) {
    throw new HttpError(400, { code: 'PGRST100', message: 'Seleção não suportada neste backend local (sem relações aninhadas)' });
  }
  return cols.join(', ');
}

function orderBy(order: string | null): string {
  if (!order) return '';
  const items = order.split(',').map((item) => {
    const [col, dir, nulls] = item.split('.');
    if (!col || !IDENT.test(col)) throw new HttpError(400, { code: 'PGRST100', message: 'Ordenação inválida' });
    const d = dir === 'desc' ? 'desc' : 'asc';
    const n = nulls === 'nullsfirst' ? ' nulls first' : nulls === 'nullslast' ? ' nulls last' : '';
    return `${col} ${d}${n}`;
  });
  return `order by ${items.join(', ')}`;
}

async function tableRequest(method: string, table: string, query: URLSearchParams, body: unknown, claims: Claims, prefer: string) {
  if (!IDENT.test(table)) throw new HttpError(404, { code: 'PGRST205', message: 'Tabela inválida' });
  const params: unknown[] = [];
  const cols = columnsList(query.get('select'));
  const returning = prefer.includes('return=representation') ? `returning ${cols}` : '';
  const wrap = (sql: string) => `with r as (${sql}) select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) as result from r`;

  return asRole(claims, async (db) => {
    if (method === 'GET') {
      const limit = Number(query.get('limit') ?? '');
      const lim = Number.isInteger(limit) && limit > 0 ? `limit ${Math.min(limit, 10000)}` : '';
      const where = buildWhere(query, params);
      const sql = `select ${cols} from public.${table} ${where} ${orderBy(query.get('order'))} ${lim}`;
      const { rows } = await db.query(`select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) as result from (${sql}) r`, params);
      return rows[0].result;
    }
    if (method === 'POST') {
      const list = (Array.isArray(body) ? body : [body]) as Record<string, unknown>[];
      const results: unknown[] = [];
      for (const row of list) {
        const keys = Object.keys(row ?? {});
        if (!keys.every((k) => IDENT.test(k))) throw new HttpError(400, { code: 'PGRST204', message: 'Coluna inválida' });
        const values = keys.map((k) => {
          params.push(toParam(row[k], 'text'));
          return `$${params.length}`;
        });
        const sql = `insert into public.${table} (${keys.join(', ')}) values (${values.join(', ')}) ${returning || 'returning 1'}`;
        const { rows } = await db.query(wrap(sql), params);
        results.push(...(rows[0].result as unknown[]));
        params.length = 0;
      }
      return returning ? results : null;
    }
    if (method === 'PATCH' || method === 'DELETE') {
      const where = buildWhere(query, params);
      if (!where) throw new HttpError(400, { code: '21000', message: 'Filtro obrigatório para alterar ou excluir' });
      let sql: string;
      if (method === 'PATCH') {
        const row = (body ?? {}) as Record<string, unknown>;
        const keys = Object.keys(row);
        if (!keys.length || !keys.every((k) => IDENT.test(k))) throw new HttpError(400, { code: 'PGRST204', message: 'Coluna inválida' });
        const sets = keys.map((k) => {
          params.push(toParam(row[k], 'text'));
          return `${k} = $${params.length}`;
        });
        sql = `update public.${table} set ${sets.join(', ')} ${where} ${returning || 'returning 1'}`;
      } else {
        sql = `delete from public.${table} ${where} ${returning || 'returning 1'}`;
      }
      const { rows } = await db.query(wrap(sql), params);
      return returning ? rows[0].result : null;
    }
    throw new HttpError(405, { code: 'PGRST117', message: 'Método não suportado' });
  });
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
interface DevUser {
  id: string;
  email: string;
  created_at: string;
}

function session(user: DevUser) {
  const now = Math.floor(Date.now() / 1000);
  const base = { sub: user.id, email: user.email, aud: 'authenticated', role: 'authenticated', iss: 'financas-em-familia-dev' };
  return {
    access_token: signJwt({ ...base, iat: now, exp: now + ACCESS_TTL, session_id: randomUUID() }),
    token_type: 'bearer',
    expires_in: ACCESS_TTL,
    expires_at: now + ACCESS_TTL,
    refresh_token: signJwt({ ...base, typ: 'refresh', iat: now, exp: now + REFRESH_TTL }),
    user: publicUser(user),
  };
}

function publicUser(user: DevUser) {
  return {
    id: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.email,
    email_confirmed_at: user.created_at,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    identities: [],
    created_at: user.created_at,
    updated_at: user.created_at,
  };
}

const authError = (status: number, code: string, msg: string) => new HttpError(status, { code: status, error_code: code, msg });

async function findUser(where: string, value: string): Promise<(DevUser & { password_hash: string }) | undefined> {
  const { rows } = await pool.query(
    `select u.id, c.email, c.password_hash, to_char(c.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
     from dev_auth.credentials c join auth.users u on u.id = c.user_id where ${where} = $1`,
    [value],
  );
  return rows[0] as (DevUser & { password_hash: string }) | undefined;
}

async function handleAuth(req: IncomingMessage, res: ServerResponse, url: URL) {
  const path = url.pathname.replace('/auth/v1', '');
  if (req.method === 'POST' && path === '/token') {
    const body = (await readJson(req)) as { email?: string; password?: string; refresh_token?: string };
    const grant = url.searchParams.get('grant_type');
    if (grant === 'password') {
      const user = await findUser('lower(c.email)', String(body.email ?? '').toLowerCase());
      if (!user || !checkPassword(String(body.password ?? ''), user.password_hash)) {
        throw authError(400, 'invalid_credentials', 'Invalid login credentials');
      }
      return send(res, 200, session(user));
    }
    if (grant === 'refresh_token') {
      const claims = verifyJwt(String(body.refresh_token ?? ''));
      if (!claims || claims.typ !== 'refresh' || !claims.sub) throw authError(400, 'refresh_token_not_found', 'Invalid Refresh Token');
      const user = await findUser('u.id::text', claims.sub);
      if (!user) throw authError(400, 'user_not_found', 'User not found');
      return send(res, 200, session(user));
    }
    throw authError(400, 'unsupported_grant_type', 'Unsupported grant type');
  }
  if (req.method === 'GET' && path === '/user') {
    const claims = requestClaimsForAuth(req);
    const user = await findUser('u.id::text', claims.sub ?? '');
    if (!user) throw authError(401, 'user_not_found', 'User not found');
    return send(res, 200, publicUser(user));
  }
  if (req.method === 'POST' && path === '/logout') {
    res.writeHead(204);
    return res.end();
  }
  if (path === '/signup') throw authError(422, 'signup_disabled', 'Signups not allowed for this instance');
  throw authError(404, 'not_found', 'Not found');
}

function requestClaimsForAuth(req: IncomingMessage): Claims {
  const auth = req.headers.authorization ?? '';
  const claims = auth.toLowerCase().startsWith('bearer ') ? verifyJwt(auth.slice(7)) : null;
  if (!claims || claims.role !== 'authenticated' || claims.typ === 'refresh') {
    throw authError(401, 'bad_jwt', 'invalid JWT');
  }
  return claims;
}

// ---------------------------------------------------------------------------
// Servidor
// ---------------------------------------------------------------------------
const server = createServer(async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  let claims: Claims | null = null;
  try {
    if (url.pathname.startsWith('/auth/v1/')) return await handleAuth(req, res, url);
    if (url.pathname.startsWith('/rest/v1/')) {
      claims = requestClaims(req);
      const rest = url.pathname.slice('/rest/v1/'.length);
      const body = req.method === 'GET' || req.method === 'DELETE' ? undefined : await readJson(req);
      const result = rest.startsWith('rpc/')
        ? await callRpc(rest.slice(4), body, claims)
        : await tableRequest(req.method ?? 'GET', rest, url.searchParams, body, claims, String(req.headers.prefer ?? ''));
      if (result === null && req.method !== 'POST') return send(res, 204);
      const wantsObject = String(req.headers.accept ?? '').includes('vnd.pgrst.object');
      if (wantsObject && Array.isArray(result)) {
        if (result.length !== 1) throw new HttpError(406, { code: 'PGRST116', message: 'Resultado não contém exatamente uma linha' });
        return send(res, 200, result[0]);
      }
      return send(res, result === null ? 204 : 200, result === null ? undefined : result);
    }
    if (url.pathname === '/health') return send(res, 200, { ok: true });
    throw new HttpError(404, { code: 'NOT_FOUND', message: 'Rota inexistente' });
  } catch (err) {
    const http = pgErrorToHttp(err, claims);
    return send(res, http.status, http.body);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.warn(`Backend local de desenvolvimento em http://127.0.0.1:${PORT} (NÃO é o Supabase; somente dados fictícios)`);
});

const shutdown = () => {
  server.close();
  void pool.end().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
