import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Columns granted to authenticated by 20261008_must_change_password.sql. select * is not one of them. */
export const REPS_GRANTED_COLUMNS = Object.freeze(['id', 'user_id', 'name', 'role', 'active', 'created_at']);

const GRANTED = new Set(REPS_GRANTED_COLUMNS);

function badColumns(list) {
  const text = String(list ?? '').trim();
  if (!text || text === '*') return ['*'];
  return text.split(',').map((part) => part.trim()).filter((column) => column && !GRANTED.has(column));
}

function selectArgument(chain) {
  const match = chain.match(/\.select\(\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)?\s*\)/);
  if (!match) return { present: false, columns: null };
  const columns = match[1] ?? match[2] ?? match[3] ?? '';
  return { present: true, columns };
}

/**
 * Client and user-token reads of public.reps. serviceFetch uses the secret key,
 * which still has table privileges, so those calls are not authenticated selects.
 */
export function repsSelectViolations(text, file = '') {
  const violations = [];
  const direct = /from\((['"])reps\1\)([\s\S]{0,500}?)(?=\.from\(|;|$)/g;
  for (const match of text.matchAll(direct)) {
    const chain = match[2];
    const writing = /\.(insert|update|upsert|delete)\(/.test(chain);
    const selected = selectArgument(chain);
    if (!selected.present) {
      if (!writing) violations.push(`${file}: from('reps') reads every column`);
      continue;
    }
    const bad = badColumns(selected.columns);
    if (bad.length) violations.push(`${file}: from('reps').select(${JSON.stringify(selected.columns)}) requests ${bad.join(', ')}`);
  }

  const embeds = /reps![A-Za-z0-9_]+(\(([^)]*)\))?/g;
  for (const match of text.matchAll(embeds)) {
    if (!match[1]) {
      violations.push(`${file}: embedded reps resource selects every column`);
      continue;
    }
    const bad = badColumns(match[2]);
    if (bad.length) violations.push(`${file}: embedded reps(${match[2]}) requests ${bad.join(', ')}`);
  }

  const flat = text.replace(/\$\{[^}]*\}/g, '');
  const queries = /reps\?[^'"`\s]*/g;
  for (const match of flat.matchAll(queries)) {
    const before = flat.slice(Math.max(0, match.index - 220), match.index);
    const serviceAt = before.lastIndexOf('serviceFetch');
    const userAt = Math.max(before.lastIndexOf('/rest/v1/reps'), before.lastIndexOf('restAll'), before.lastIndexOf('rest('));
    if (serviceAt >= 0 && serviceAt > userAt) continue;
    const query = match[0];
    const select = query.match(/(?:^|[?&])select=([^&]*)/);
    if (!select) {
      violations.push(`${file}: user-token ${query} has no column list`);
      continue;
    }
    const columns = decodeURIComponent(select[1]);
    const bad = badColumns(columns);
    if (bad.length) violations.push(`${file}: user-token select=${columns} requests ${bad.join(', ')}`);
  }
  return violations;
}

assert.deepEqual(repsSelectViolations("sb.from('reps').select('*')"), [
  ': from(\'reps\').select("*") requests *'
]);
assert.ok(repsSelectViolations('await sb.from("reps").select()')[0].includes('requests *'));
assert.ok(repsSelectViolations("sb.from('reps').select('id,email')")[0].includes('email'));
assert.deepEqual(repsSelectViolations("sb.from('reps').select('id,user_id,name,role,active,created_at')"), []);
assert.ok(repsSelectViolations('uploader:reps!lead_photos_uploaded_by_fkey(id,email)')[0].includes('email'));
assert.ok(repsSelectViolations('actor:reps!lead_activity_actor_id_fkey')[0].includes('every column'));
assert.deepEqual(repsSelectViolations('actor:reps!lead_activity_actor_id_fkey(name,role)'), []);
assert.deepEqual(repsSelectViolations("serviceFetch(env, fetchImpl, `/reps?id=eq.1&select=id,email`)"), []);
assert.ok(repsSelectViolations("fetchImpl(`${base}/rest/v1/reps?select=email`)")[0].includes('email'));
assert.ok(repsSelectViolations('rest(token, `reps?select=*`)')[0].includes('*'));
assert.deepEqual(repsSelectViolations('rest(token, `reps?select=id,name,role`)'), []);

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const skip = new Set(['node_modules', 'vendor', 'scripts', 'data']);

function filesIn(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) filesIn(path, out);
    else if (/\.(js|html|mjs)$/.test(name)) out.push(path);
  }
  return out;
}

const violations = [];
for (const path of filesIn(root)) {
  const text = readFileSync(path, 'utf8');
  violations.push(...repsSelectViolations(text, relative(root, path)));
}
assert.deepEqual(violations, []);

const migration = readFileSync(join(root, 'supabase/migrations/20261008_must_change_password.sql'), 'utf8');
for (const line of [
  'revoke select, insert, update, delete on table public.reps from authenticated;',
  'grant select (id, user_id, name, role, active, created_at) on table public.reps to authenticated;',
  'grant insert (id, user_id, name, email, phone, role, active) on table public.reps to authenticated;',
  'grant update (name, email, phone, role, active) on table public.reps to authenticated;'
]) {
  assert.ok(migration.includes(line), line);
}
const proof = readFileSync(join(root, 'scripts/reps-column-grants.sql'), 'utf8');
for (const line of [
  'grant select (id, user_id, name, role, active, created_at) on table public.reps to authenticated;',
  "execute 'select * from public.reps';"
]) {
  assert.ok(proof.includes(line), line);
}

function psqlAvailable() {
  try {
    execFileSync('sudo', ['-u', 'postgres', 'psql', '-c', 'select 1'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (psqlAvailable()) {
  execFileSync('sudo', ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres', '-c',
    'drop database if exists tn_reps_grants']);
  execFileSync('sudo', ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres', '-c',
    "do $$ begin if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if; if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if; end $$"]);
  execFileSync('sudo', ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres', '-c',
    'create database tn_reps_grants']);
  execFileSync('sudo', ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-d', 'tn_reps_grants', '-f',
    join(root, 'scripts/reps-column-grants.sql')], { stdio: 'pipe' });
  console.log('reps column grants verified on local postgres');
} else {
  console.log('reps column grants: local postgres not running, source scan only');
}

console.log('reps-select tests ok');
