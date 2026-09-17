#!/usr/bin/env node
// body-corporate-for-claude-code: the one CLI. Claude Code slash commands call
// this; so can you.
//
//   node scripts/strata.mjs <command> [args] [--flags] [--json]
//
// Run with no arguments (or `help`) for the command list.
//
// This system records the schemes, lots, owners, levies, arrears, meetings,
// maintenance, insurance, disclosures and compliance a body corporate manager
// runs every week. It never holds money. The body corporate's bank account and
// its trust ledger stay in the system that already holds them.

import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { parseCsv, pick } from './lib/csv.mjs';
import { table, money, price, isoDate, short, truncate, heading } from './lib/format.mjs';

// ---------------------------------------------------------------------------
// Argument parsing

const BOOL_FLAGS = new Set([
  'json', 'help', 'all', 'open', 'closed', 'dry-run', 'csv', 'overdue', 'urgent',
  'force', 'pending', 'expired', 'quorum', 'primary', 'preferred',
]);

function parseArgv(argv) {
  const args = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      flags.help = true;
      continue;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      let name;
      let value;
      if (eq > -1) {
        name = a.slice(2, eq);
        value = a.slice(eq + 1);
      } else {
        name = a.slice(2);
        const next = argv[i + 1];
        if (BOOL_FLAGS.has(name) || next === undefined || next.startsWith('--')) value = true;
        else value = argv[++i];
      }
      flags[name] = value;
    } else {
      args.push(a);
    }
  }
  return { args, flags };
}

class CliError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

const num = (v) => Number(v ?? 0);
const str = (v) => (v === true || v === undefined || v === null ? '' : String(v));

// ---------------------------------------------------------------------------
// Dates and money

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Working days, the way the Act counts them for a disclosure statement.
function addWorkingDays(iso, n) {
  let out = iso;
  let left = n;
  while (left > 0) {
    out = addDays(out, 1);
    const dow = new Date(`${out}T00:00:00`).getDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return out;
}

function parseDate(v, what = 'date') {
  if (!v || v === true) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const lower = s.toLowerCase();
  if (lower === 'today') return today();
  if (lower === 'yesterday') return addDays(today(), -1);
  if (lower === 'tomorrow') return addDays(today(), 1);
  // New Zealand and Australian strata exports write DD/MM/YYYY, so the first
  // number is the day unless the second one is too big to be a month.
  const slash = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const [day, month] = b > 12 ? [b, a] : [a, b];
    const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new CliError(`"${v}" is not a ${what}. Use YYYY-MM-DD.`);
  return isoDate(d);
}

function parseMoney(v) {
  if (v === undefined || v === null || v === '' || v === true) return 0;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  if (Number.isNaN(n)) throw new CliError(`"${v}" is not an amount.`);
  return Math.round(n * 100);
}

// ---------------------------------------------------------------------------
// Lookups: full id, first 4+ characters of an id, exact code, name or number,
// then contains. One hit wins. Several hits list the candidates and exit 1.

const RESOLVERS = {
  scheme: {
    from: 'schemes c left join managers m on m.id = c.manager_id',
    cols: 'c.*, m.full_name as manager_name',
    exact: 'lower(c.code) = lower($1) or lower(c.name) = lower($1) or lower(coalesce(c.plan_number, \'\')) = lower($1)',
    fuzzy: 'c.name ilike $1 or c.code ilike $1 or c.address_line ilike $1 or c.suburb ilike $1',
    label: (r) => `${r.code}  ${r.name}, ${r.suburb || ''} (${r.status})`,
    order: 'c.code',
    listing: 'schemes',
  },
  lot: {
    from: `lots c join schemes s on s.id = c.scheme_id`,
    cols: 'c.*, s.code as scheme_code, s.name as scheme_name, s.manager_id as scheme_manager_id',
    exact: 'lower(c.ref) = lower($1) or lower(c.external_ref) = lower($1)',
    fuzzy: `c.ref ilike $1 or c.unit_label ilike $1 or s.name ilike $1
            or exists (select 1 from lot_owners lo join owners o on o.id = lo.owner_id
                       where lo.lot_id = c.id and lo.until_on is null and o.name ilike $1)`,
    label: (r) => `${r.ref}  ${r.unit_label || 'Lot ' + r.lot_number}, ${r.scheme_name}`,
    order: 'c.ref',
    listing: 'lots',
  },
  owner: {
    from: 'owners c',
    cols: 'c.*',
    exact: 'lower(c.name) = lower($1) or lower(c.email) = lower($1) or lower(coalesce(c.external_ref, \'\')) = lower($1)',
    fuzzy: 'c.name ilike $1 or c.email ilike $1',
    label: (r) => `${r.name}${r.owner_type === 'individual' ? '' : ` (${r.owner_type})`}`,
    order: 'c.name',
    listing: 'owners --all',
  },
  manager: {
    from: 'managers c',
    cols: 'c.*',
    exact: 'lower(c.full_name) = lower($1) or lower(coalesce(c.code, \'\')) = lower($1) or lower(coalesce(c.email, \'\')) = lower($1)',
    fuzzy: 'c.full_name ilike $1 or c.code ilike $1',
    label: (r) => `${r.full_name} (${r.role})`,
    order: 'c.full_name',
    listing: 'managers',
  },
  contractor: {
    from: 'contractors c',
    cols: 'c.*',
    exact: 'lower(c.name) = lower($1) or lower(coalesce(c.external_ref, \'\')) = lower($1)',
    fuzzy: 'c.name ilike $1 or c.trade ilike $1 or c.contact_name ilike $1',
    label: (r) => `${r.name} (${r.trade})`,
    order: 'c.name',
    listing: 'contractors --all',
  },
  maintenance: {
    from: 'maintenance_requests c join schemes s on s.id = c.scheme_id',
    cols: 'c.*, s.code as scheme_code, s.name as scheme_name, s.committee_spend_limit_cents',
    exact: 'lower(coalesce(c.job_ref, \'\')) = lower($1)',
    fuzzy: 'c.job_ref ilike $1 or c.summary ilike $1 or s.name ilike $1 or s.code ilike $1',
    label: (r) => `${r.job_ref || short(r.id)}  ${r.scheme_name}: ${truncate(r.summary, 40)} (${r.status})`,
    order: 'c.reported_on desc',
    listing: 'maintenance --all',
  },
  job: {
    from: `contractor_jobs c join maintenance_requests mr on mr.id = c.maintenance_id
           join schemes s on s.id = mr.scheme_id left join contractors ct on ct.id = c.contractor_id`,
    cols: 'c.*, mr.summary, mr.job_ref, s.code as scheme_code, s.name as scheme_name, ct.name as contractor_name',
    exact: 'lower(coalesce(c.job_no, \'\')) = lower($1) or lower(coalesce(c.invoice_ref, \'\')) = lower($1)',
    fuzzy: 'c.job_no ilike $1 or mr.summary ilike $1 or s.name ilike $1',
    label: (r) => `${r.job_no || short(r.id)}  ${r.scheme_name}: ${truncate(r.summary, 36)} (${r.status})`,
    order: 'c.issued_on desc nulls last',
    listing: 'jobs --all',
  },
  meeting: {
    from: 'meetings c join schemes s on s.id = c.scheme_id',
    cols: 'c.*, s.code as scheme_code, s.name as scheme_name',
    exact: "c.id::text = lower($1)",
    fuzzy: 's.name ilike $1 or s.code ilike $1 or c.kind ilike $1',
    label: (r) => `${short(r.id)}  ${r.scheme_name} ${r.kind} ${isoDate(r.held_on || r.scheduled_on)} (${r.held_on ? 'held' : 'booked'})`,
    order: 'coalesce(c.held_on, c.scheduled_on) desc',
    listing: 'meetings --all',
  },
  policy: {
    from: 'insurance_policies c join schemes s on s.id = c.scheme_id',
    cols: 'c.*, s.code as scheme_code, s.name as scheme_name',
    exact: 'lower(coalesce(c.policy_number, \'\')) = lower($1)',
    fuzzy: 'c.policy_number ilike $1 or c.insurer ilike $1 or s.name ilike $1 or s.code ilike $1',
    label: (r) => `${r.policy_number || short(r.id)}  ${r.scheme_name} ${r.kind} (${r.insurer || 'no insurer'}, expires ${isoDate(r.expires_on)})`,
    order: 'c.expires_on desc',
    listing: 'insurance',
  },
  disclosure: {
    from: 'disclosure_requests c join schemes s on s.id = c.scheme_id left join lots l on l.id = c.lot_id',
    cols: 'c.*, s.code as scheme_code, s.name as scheme_name, l.ref as lot_ref',
    exact: "c.id::text = lower($1) or lower(coalesce(l.ref, '')) = lower($1)",
    fuzzy: 's.name ilike $1 or l.ref ilike $1 or c.requested_by ilike $1',
    label: (r) => `${short(r.id)}  ${r.lot_ref || r.scheme_name} ${r.kind} requested ${isoDate(r.requested_on)}${r.provided_on ? ' (provided)' : ''}`,
    order: 'c.requested_on desc',
    listing: 'disclosures --all',
  },
  task: {
    from: 'tasks c left join schemes s on s.id = c.scheme_id',
    cols: 'c.*, s.code as scheme_code, s.name as scheme_name',
    exact: 'lower(c.title) = lower($1)',
    fuzzy: 'c.title ilike $1 or s.name ilike $1',
    label: (r) => `${short(r.id)}  ${truncate(r.title, 50)} (${r.status})`,
    order: 'c.due_on',
    listing: 'tasks --all',
  },
};

const ID_RE = /^[0-9a-f]{4,8}(-[0-9a-f-]*)?$/i;

async function resolve(db, kind, q, { optional = false } = {}) {
  const spec = RESOLVERS[kind];
  q = String(q ?? '').trim();
  if (!q || q === 'true') {
    if (optional) return null;
    throw new CliError(`Give me a ${kind} name, reference or id.`);
  }
  const select = `select ${spec.cols} from ${spec.from}`;
  let rows = [];
  if (ID_RE.test(q)) {
    rows = await db.query(`${select} where c.id::text like $1 order by ${spec.order}`, [q.toLowerCase() + '%']);
    if (rows.length === 1) return rows[0];
  }
  if (!rows.length) rows = await db.query(`${select} where ${spec.exact} order by ${spec.order}`, [q]);
  if (rows.length === 1) return rows[0];
  if (!rows.length) rows = await db.query(`${select} where ${spec.fuzzy} order by ${spec.order}`, [`%${q}%`]);
  if (rows.length === 1) return rows[0];
  if (!rows.length) {
    if (optional) return null;
    throw new CliError(`No ${kind} matches "${q}". Run \`${spec.listing}\` to see what exists.`);
  }
  throw new CliError(
    `"${q}" matches ${rows.length} ${kind} records. Use a reference, an id, or a longer name:\n` +
      rows.map((r) => `  ${short(r.id)}  ${spec.label(r)}`).join('\n'),
  );
}

// The person doing the work: --manager, BC_MANAGER, or the only active manager.
async function whoIs(db, flags, { optional = true } = {}) {
  const named = flags.manager || process.env.BC_MANAGER;
  if (named && named !== true) return resolve(db, 'manager', named);
  const rows = await db.query('select * from managers where active order by full_name');
  if (rows.length === 1) return rows[0];
  if (optional) return null;
  if (!rows.length) throw new CliError('No managers on file. Add one: add manager "<name>"');
  throw new CliError(
    'Several people work here. Pass --manager= (or set BC_MANAGER):\n' +
      rows.map((r) => `  ${r.code || short(r.id)}  ${r.full_name}`).join('\n'),
  );
}

// The seven compliance items every scheme carries, created as "unknown" because
// this system will not call a scheme compliant on no evidence.
const SCHEME_COMPLIANCE_KINDS = [
  ['long-term maintenance plan review', 'Unit Titles Act 2010, s 116: plan covers at least 10 years, reviewed regularly'],
  ['insurance replacement valuation', 'Unit Titles Act 2010, s 135: principal insurance at full replacement value'],
  ['building warrant of fitness', 'Building Act 2004, s 108: annual BWoF while a compliance schedule is in force'],
  ['financial statements and audit', 'Unit Titles Act 2010, s 132: statements prepared and audited unless opted out'],
  ['fire evacuation scheme', 'Fire and Emergency New Zealand Act 2017, s 76: approved evacuation scheme for relevant buildings'],
  ['asbestos register', 'Health and Safety at Work (Asbestos) Regulations 2016: management plan where asbestos is present'],
  ['pool barrier compliance', 'Building Act 2004, ss 162A to 162E: pool barrier inspected every three years'],
];

async function createComplianceItems(db, schemeId) {
  for (const [kind, standard] of SCHEME_COMPLIANCE_KINDS) {
    await db.query(
      "insert into compliance_items (scheme_id, kind, standard, status) values ($1, $2, $3, 'unknown') on conflict do nothing",
      [schemeId, kind, standard],
    );
  }
}

// ---------------------------------------------------------------------------
// Reads: the portfolio

async function cmdSchemes(db, args, flags) {
  const q = args.join(' ').trim();
  const where = [];
  const params = [];
  if (!flags.all) where.push("s.status = 'managed'");
  if (flags.manager && flags.manager !== true) {
    const m = await resolve(db, 'manager', flags.manager);
    params.push(m.full_name);
    where.push(`s.manager = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    where.push(`(s.scheme ilike $${params.length} or s.scheme_code ilike $${params.length} or s.suburb ilike $${params.length})`);
  }
  const rows = await db.query(
    `select * from v_scheme_summary s ${where.length ? 'where ' + where.join(' and ') : ''} order by s.scheme_code`,
    params,
  );
  const arrears = rows.reduce((a, r) => a + num(r.arrears_cents), 0);
  const lots = rows.reduce((a, r) => a + num(r.lots), 0);
  const text =
    heading(`The portfolio (${rows.length} schemes, ${lots} lots, ${money(arrears)} in arrears)`) +
    '\n' +
    table(rows, [
      { key: 'scheme_code', label: 'Code' },
      { key: 'scheme', label: 'Scheme', width: 26 },
      { key: 'suburb', label: 'Suburb', width: 13 },
      { key: 'lots', label: 'Lots', align: 'right' },
      { key: 'arrears_cents', label: 'Arrears', align: 'right', format: (v) => (num(v) ? money(v) : '') },
      { key: 'agm_deadline', label: 'AGM by', format: (v) => isoDate(v) },
      {
        key: 'days_to_deadline',
        label: 'AGM position',
        width: 14,
        format: (v, r) => (r.agm_held_this_year ? 'held' : r.agm_booked ? 'booked' : num(v) < 0 ? `${-v}d OVERDUE` : `${v}d left`),
      },
      { key: 'insurance_expires_on', label: 'Insurance', format: (v) => (v && isoDate(v) < today() ? `EXPIRED ${isoDate(v)}` : isoDate(v)) },
      { key: 'open_maintenance', label: 'Jobs', align: 'right' },
      { key: 'compliance_gaps', label: 'Gaps', align: 'right' },
      { key: 'manager', label: 'Manager', width: 13 },
    ]);
  return { text, json: rows };
}

async function cmdScheme(db, args) {
  const s = await resolve(db, 'scheme', args.join(' '));
  const [summary] = await db.query('select * from v_scheme_summary where scheme_id = $1', [s.id]);
  const committee = await db.query(
    `select cm.role, o.name, o.email, o.phone, cm.since_on from committee_members cm
     join owners o on o.id = cm.owner_id where cm.scheme_id = $1 and cm.until_on is null
     order by case cm.role when 'chairperson' then 1 else 2 end, o.name`,
    [s.id],
  );
  const lots = await db.query(
    `select p.*, (p.charged_due_cents - p.paid_cents) as arrears_cents from v_lot_position p
     where p.scheme_id = $1 order by p.lot_number`,
    [s.id],
  );
  const runs = await db.query(
    `select r.*, (select count(*) from levy_charges c where c.levy_run_id = r.id) as lots
     from levy_runs r where r.scheme_id = $1 order by r.due_on desc limit 6`,
    [s.id],
  );
  const meetings = await db.query(
    'select * from meetings where scheme_id = $1 order by coalesce(held_on, scheduled_on) desc limit 5',
    [s.id],
  );
  const insurance = await db.query('select * from v_insurance_position where scheme_id = $1 order by kind', [s.id]);
  const maintenance = await db.query('select * from v_maintenance_open where scheme_id = $1 order by days_open desc', [s.id]);
  const compliance = await db.query('select * from compliance_items where scheme_id = $1 order by kind', [s.id]);
  const notes = await db.query('select * from contact_notes where scheme_id = $1 order by happened_on desc limit 6', [s.id]);

  const lines = [heading(`${s.code}  ${s.name}  ${s.address_line || ''}, ${s.suburb || ''}`)];
  lines.push(
    `  Plan         ${s.plan_number || 'not recorded'}, ${s.scheme_type}, built ${s.year_built || '?'}, ${summary.lots} lots`,
    `  Manager      ${s.manager_name || 'unassigned'}, managed since ${isoDate(s.managed_since)}`,
    `  Agreement    ${money(s.base_fee_annual_cents)} a year base fee, expires ${isoDate(s.agreement_expires_on) || 'not recorded'}`,
    `  Chairperson  ${summary.chairperson || 'NONE ON FILE'}`,
    `  FY end       ${isoDate(s.last_fy_end_on)}. AGM deadline ${isoDate(summary.agm_deadline)} (six months, UTA 2010 s 89): ` +
      (summary.agm_held_this_year ? 'held' : summary.agm_booked ? 'booked' : num(summary.days_to_deadline) < 0 ? `${-summary.days_to_deadline} days OVERDUE` : `${summary.days_to_deadline} days left, nothing booked`),
    `  Committee    delegated spend limit ${money(s.committee_spend_limit_cents)}`,
    `  LTMP         ${s.ltmp_years || '?'} years, last reviewed ${isoDate(s.ltmp_reviewed_on) || 'NEVER'}`,
    `  Arrears      ${money(summary.arrears_cents)} across ${summary.lots_in_arrears} lots`,
    `  Last spoke   ${summary.days_since_contact === null || summary.days_since_contact === undefined ? 'never' : summary.days_since_contact + ' days ago'}`,
  );
  if (s.notes) lines.push(`  Notes        ${s.notes}`);

  if (committee.length) {
    lines.push(heading('The committee'));
    for (const c of committee) lines.push(`  ${String(c.role).padEnd(18)} ${String(c.name).padEnd(28)} ${c.email || ''}  ${c.phone || ''}`);
  }

  lines.push(heading('Lots'));
  lines.push(
    table(lots, [
      { key: 'lot_ref', label: 'Ref' },
      { key: 'unit', label: 'Unit', width: 14 },
      { key: 'lot_type', label: 'Type', width: 11 },
      { key: 'utility_interest', label: 'Interest', align: 'right' },
      { key: 'owners', label: 'Owner', width: 30 },
      { key: 'arrears_cents', label: 'Arrears', align: 'right', format: (v) => (num(v) > 0 ? money(v) : '') },
      { key: 'last_payment_on', label: 'Last paid', format: (v) => isoDate(v) },
    ]),
  );

  lines.push(heading('Levy runs'));
  lines.push(
    table(runs, [
      { key: 'name', label: 'Levy', width: 24 },
      { key: 'fund', label: 'Fund', width: 11 },
      { key: 'struck_on', label: 'Struck', format: (v) => isoDate(v) },
      { key: 'due_on', label: 'Due', format: (v) => isoDate(v) },
      { key: 'total_cents', label: 'Total', align: 'right', format: (v) => money(v) },
      { key: 'lots', label: 'Lots', align: 'right' },
    ]),
  );

  lines.push(heading('Meetings'));
  lines.push(
    table(meetings, [
      { key: 'kind', label: 'Kind', width: 10 },
      { key: 'scheduled_on', label: 'Booked', format: (v) => isoDate(v) },
      { key: 'notice_sent_on', label: 'Notice', format: (v) => isoDate(v) },
      { key: 'held_on', label: 'Held', format: (v) => isoDate(v) },
      { key: 'minutes_sent_on', label: 'Minutes', format: (v, r) => (v ? isoDate(v) : r.held_on ? 'NOT SENT' : '') },
      { key: 'note', label: 'Note', width: 50, format: (v) => truncate(v, 50) },
    ]),
  );

  lines.push(heading('Insurance'));
  lines.push(
    table(insurance, [
      { key: 'kind', label: 'Policy', width: 15 },
      { key: 'insurer', label: 'Insurer', width: 10 },
      { key: 'policy_number', label: 'Number', width: 10 },
      { key: 'sum_insured_cents', label: 'Sum insured', align: 'right', format: (v) => money(v) },
      { key: 'valuation_on', label: 'Valuation', format: (v) => isoDate(v) },
      { key: 'expires_on', label: 'Expires', format: (v) => (v && isoDate(v) < today() ? `EXPIRED ${isoDate(v)}` : isoDate(v)) },
      { key: 'premium_cents', label: 'Premium', align: 'right', format: (v) => (num(v) ? money(v) : '') },
    ]),
  );

  if (maintenance.length) {
    lines.push(heading('Maintenance open'));
    lines.push(
      table(maintenance, [
        { key: 'job_ref', label: 'Ref' },
        { key: 'summary', label: 'What', width: 44, format: (v) => truncate(v, 44) },
        { key: 'priority', label: 'Priority', width: 8 },
        { key: 'status', label: 'Status', width: 26 },
        { key: 'days_open', label: 'Days', align: 'right' },
        { key: 'contractor', label: 'Contractor', width: 24 },
        { key: 'quoted_cents', label: 'Quoted', align: 'right', format: (v) => (num(v) ? money(v) : '') },
      ]),
    );
  }

  lines.push(heading('Compliance'));
  lines.push(
    table(compliance, [
      { key: 'kind', label: 'Item', width: 34 },
      { key: 'status', label: 'Status', width: 14 },
      { key: 'assessed_on', label: 'Assessed', format: (v) => isoDate(v) },
      { key: 'due_on', label: 'Due', format: (v) => isoDate(v) },
      { key: 'note', label: 'Note', width: 58, format: (v) => truncate(v, 58) },
    ]),
  );

  if (notes.length) {
    lines.push(heading('Contact'));
    for (const n of notes) lines.push(`  ${isoDate(n.happened_on)}  ${String(n.kind).padEnd(7)} ${n.who || ''}: ${truncate(n.body, 90)}`);
  }
  return { text: lines.join('\n'), json: { scheme: s, summary, committee, lots, runs, meetings, insurance, maintenance, compliance, notes } };
}

async function cmdLots(db, args, flags) {
  const q = args.join(' ').trim();
  const where = [];
  const params = [];
  if (flags.scheme && flags.scheme !== true) {
    const s = await resolve(db, 'scheme', flags.scheme);
    params.push(s.id);
    where.push(`p.scheme_id = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    where.push(`(p.lot_ref ilike $${params.length} or p.owners ilike $${params.length} or p.scheme ilike $${params.length})`);
  }
  const rows = await db.query(
    `select p.*, (p.charged_due_cents - p.paid_cents) as arrears_cents from v_lot_position p
     ${where.length ? 'where ' + where.join(' and ') : ''} order by p.scheme_code, p.lot_number`,
    params,
  );
  const text =
    heading(`Lots (${rows.length})`) +
    '\n' +
    table(rows, [
      { key: 'lot_ref', label: 'Ref' },
      { key: 'scheme', label: 'Scheme', width: 24 },
      { key: 'unit', label: 'Unit', width: 14 },
      { key: 'lot_type', label: 'Type', width: 11 },
      { key: 'utility_interest', label: 'Interest', align: 'right' },
      { key: 'owners', label: 'Owner', width: 30 },
      { key: 'arrears_cents', label: 'Arrears', align: 'right', format: (v) => (num(v) > 0 ? money(v) : '') },
      { key: 'last_payment_on', label: 'Last paid', format: (v) => isoDate(v) },
    ]);
  return { text, json: rows };
}

async function cmdLot(db, args) {
  const l = await resolve(db, 'lot', args.join(' '));
  const [position] = await db.query('select * from v_lot_position where lot_id = $1', [l.id]);
  const owners = await db.query(
    `select o.*, lo.is_primary, lo.since_on from lot_owners lo join owners o on o.id = lo.owner_id
     where lo.lot_id = $1 and lo.until_on is null order by lo.is_primary desc, o.name`,
    [l.id],
  );
  const charges = await db.query(
    `select r.name, r.fund, r.due_on, c.amount_cents from levy_charges c join levy_runs r on r.id = c.levy_run_id
     where c.lot_id = $1 order by r.due_on desc limit 10`,
    [l.id],
  );
  const payments = await db.query('select * from levy_payments where lot_id = $1 order by paid_on desc limit 10', [l.id]);
  const [arrears] = await db.query('select * from v_arrears where lot_id = $1', [l.id]);
  const events = await db.query('select * from arrears_events where lot_id = $1 order by noted_on desc', [l.id]);
  const disclosures = await db.query('select * from disclosure_requests where lot_id = $1 order by requested_on desc limit 5', [l.id]);
  const notes = await db.query('select * from contact_notes where lot_id = $1 order by happened_on desc limit 6', [l.id]);

  const lines = [heading(`${l.ref}  ${l.unit_label || 'Lot ' + l.lot_number}, ${l.scheme_name}`)];
  lines.push(
    `  Owner        ${position.owners}  ${position.owner_email || ''}`,
    `  Lot          number ${l.lot_number}, ${l.lot_type}${l.bedrooms ? `, ${l.bedrooms} bed` : ''}, utility interest ${l.utility_interest}`,
    `  Charged      ${money(position.charged_due_cents)} fallen due (${money(position.charged_all_cents)} struck in total)`,
    `  Paid         ${money(position.paid_cents)}, last payment ${isoDate(position.last_payment_on) || 'never'}`,
  );
  if (arrears) {
    lines.push(`  Arrears      ${money(arrears.arrears_cents)}, ${arrears.days_behind} days behind (since ${isoDate(arrears.arrears_since)})`);
  } else {
    lines.push('  Arrears      none, levies are up to date');
  }
  if (l.notes) lines.push(`  Notes        ${l.notes}`);

  lines.push(heading('Levies charged'));
  lines.push(
    table(charges, [
      { key: 'name', label: 'Levy', width: 24 },
      { key: 'fund', label: 'Fund', width: 11 },
      { key: 'due_on', label: 'Due', format: (v) => isoDate(v) },
      { key: 'amount_cents', label: 'Amount', align: 'right', format: (v) => price(v) },
    ]),
  );
  lines.push(heading('Payments received, most recent first'));
  lines.push(
    table(payments, [
      { key: 'paid_on', label: 'Date', format: (v) => isoDate(v) },
      { key: 'amount_cents', label: 'Amount', align: 'right', format: (v) => price(v) },
      { key: 'method', label: 'How', width: 14 },
      { key: 'reference', label: 'Reference', width: 12 },
      { key: 'note', label: 'Note', width: 40, format: (v) => truncate(v, 40) },
    ]),
  );
  lines.push('  The ledger is a record. The money itself sits in the body corporate\'s bank account.');

  if (events.length) {
    lines.push(heading('Arrears ladder'));
    for (const a of events) {
      lines.push(`  ${isoDate(a.noted_on)}  ${String(a.action).padEnd(16)} ${money(a.amount_cents).padStart(9)}  ${truncate(a.note, 80)}`);
    }
  }
  if (disclosures.length) {
    lines.push(heading('Disclosures'));
    for (const d of disclosures) {
      lines.push(`  ${isoDate(d.requested_on)}  ${String(d.kind).padEnd(16)} ${d.provided_on ? 'provided ' + isoDate(d.provided_on) : 'OPEN'}  ${truncate(d.requested_by, 50)}`);
    }
  }
  if (notes.length) {
    lines.push(heading('Contact'));
    for (const n of notes) lines.push(`  ${isoDate(n.happened_on)}  ${String(n.kind).padEnd(7)} ${n.who || ''}: ${truncate(n.body, 90)}`);
  }
  return { text: lines.join('\n'), json: { lot: l, position, owners, charges, payments, arrears, events, disclosures, notes } };
}

async function cmdOwners(db, args, flags) {
  const q = args.join(' ').trim();
  const params = [];
  const where = [];
  if (!flags.all) where.push("o.status = 'active'");
  if (q) {
    params.push(`%${q}%`);
    where.push(`(o.name ilike $${params.length} or o.email ilike $${params.length})`);
  }
  const rows = await db.query(
    `select o.name as owner, o.owner_type, o.email, o.phone,
            (select count(*) from lot_owners lo where lo.owner_id = o.id and lo.until_on is null) as lots,
            coalesce((select sum(p.charged_due_cents - p.paid_cents) from lot_owners lo
                      join v_lot_position p on p.lot_id = lo.lot_id
                      where lo.owner_id = o.id and lo.until_on is null and p.charged_due_cents > p.paid_cents), 0) as arrears_cents,
            coalesce((select string_agg(distinct cm.role, ', ') from committee_members cm
                      where cm.owner_id = o.id and cm.until_on is null), '') as committee
     from owners o
     ${where.length ? 'where ' + where.join(' and ') : ''}
     order by o.name`,
    params,
  );
  const text =
    heading(`Owners (${rows.length})`) +
    '\n' +
    table(rows, [
      { key: 'owner', label: 'Owner', width: 30 },
      { key: 'owner_type', label: 'Type', width: 10 },
      { key: 'email', label: 'Email', width: 28 },
      { key: 'phone', label: 'Phone', width: 13 },
      { key: 'lots', label: 'Lots', align: 'right' },
      { key: 'arrears_cents', label: 'Arrears', align: 'right', format: (v) => (num(v) ? money(v) : '') },
      { key: 'committee', label: 'Committee', width: 18 },
    ]);
  return { text, json: rows };
}

async function cmdOwner(db, args) {
  const o = await resolve(db, 'owner', args.join(' '));
  const lots = await db.query(
    `select p.*, (p.charged_due_cents - p.paid_cents) as arrears_cents from v_lot_position p
     join lot_owners lo on lo.lot_id = p.lot_id
     where lo.owner_id = $1 and lo.until_on is null order by p.lot_ref`,
    [o.id],
  );
  const committee = await db.query(
    `select cm.role, s.name as scheme, cm.since_on from committee_members cm join schemes s on s.id = cm.scheme_id
     where cm.owner_id = $1 and cm.until_on is null`,
    [o.id],
  );
  const notes = await db.query('select * from contact_notes where owner_id = $1 order by happened_on desc limit 8', [o.id]);
  const lines = [heading(`${o.name}${o.owner_type === 'individual' ? '' : ` (${o.owner_type})`}`)];
  lines.push(
    `  Contact      ${o.email || 'no email'}  ${o.phone || ''}`,
    `  Lots         ${lots.length}, arrears ${money(lots.reduce((a, r) => a + Math.max(0, num(r.arrears_cents)), 0))}`,
  );
  for (const c of committee) lines.push(`  Committee    ${c.role}, ${c.scheme}, since ${isoDate(c.since_on)}`);
  if (o.notes) lines.push(`  Notes        ${o.notes}`);
  lines.push(heading('Lots'));
  lines.push(
    table(lots, [
      { key: 'lot_ref', label: 'Ref' },
      { key: 'scheme', label: 'Scheme', width: 26 },
      { key: 'unit', label: 'Unit', width: 14 },
      { key: 'utility_interest', label: 'Interest', align: 'right' },
      { key: 'arrears_cents', label: 'Arrears', align: 'right', format: (v) => (num(v) > 0 ? money(v) : '') },
      { key: 'last_payment_on', label: 'Last paid', format: (v) => isoDate(v) },
    ]),
  );
  if (notes.length) {
    lines.push(heading('Contact'));
    for (const n of notes) lines.push(`  ${isoDate(n.happened_on)}  ${String(n.kind).padEnd(7)} ${truncate(n.body, 96)}`);
  }
  return { text: lines.join('\n'), json: { owner: o, lots, committee, notes } };
}

async function cmdCommittee(db, args, flags) {
  const [verb, ...rest] = args;
  if (verb === 'add') {
    const s = await resolve(db, 'scheme', flags.scheme || rest[0]);
    const o = await resolve(db, 'owner', flags.owner || rest.slice(flags.scheme ? 0 : 1).join(' '));
    const [row] = await db.query(
      `insert into committee_members (scheme_id, owner_id, role, since_on) values ($1, $2, $3, $4)
       on conflict (scheme_id, owner_id) do update set role = $3, until_on = null returning *`,
      [s.id, o.id, str(flags.role) || 'committee member', parseDate(flags.on) || today()],
    );
    return { text: `${o.name} is now ${row.role} of ${s.name}.`, json: row };
  }
  if (verb === 'remove') {
    const s = await resolve(db, 'scheme', flags.scheme || rest[0]);
    const o = await resolve(db, 'owner', flags.owner || rest.slice(flags.scheme ? 0 : 1).join(' '));
    const [row] = await db.query(
      'update committee_members set until_on = $3 where scheme_id = $1 and owner_id = $2 and until_on is null returning *',
      [s.id, o.id, parseDate(flags.on) || today()],
    );
    if (!row) throw new CliError(`${o.name} is not on the ${s.name} committee.`);
    return { text: `${o.name} has left the ${s.name} committee.`, json: row };
  }
  const params = [];
  let where = 'cm.until_on is null';
  if (verb) {
    const s = await resolve(db, 'scheme', args.join(' '));
    params.push(s.id);
    where += ` and cm.scheme_id = $${params.length}`;
  }
  const rows = await db.query(
    `select s.code as scheme_code, s.name as scheme, cm.role, o.name as member, o.email, o.phone, cm.since_on
     from committee_members cm join schemes s on s.id = cm.scheme_id join owners o on o.id = cm.owner_id
     where ${where}
     order by s.code, case cm.role when 'chairperson' then 1 else 2 end, o.name`,
    params,
  );
  const text =
    heading(`Committees (${rows.length} seats)`) +
    '\n' +
    table(rows, [
      { key: 'scheme_code', label: 'Code' },
      { key: 'scheme', label: 'Scheme', width: 26 },
      { key: 'role', label: 'Role', width: 18 },
      { key: 'member', label: 'Member', width: 28 },
      { key: 'email', label: 'Email', width: 26 },
      { key: 'phone', label: 'Phone', width: 13 },
      { key: 'since_on', label: 'Since', format: (v) => isoDate(v) },
    ]);
  return { text, json: rows };
}

// ---------------------------------------------------------------------------
// Arrears

const ARREARS_STEP = (r) => {
  if (num(r.days_behind) >= 90 && !r.recovery_started_on) return 'Start debt recovery. The ladder is complete on file.';
  if (num(r.days_behind) >= 60 && !r.last_demand_on) return 'Issue the formal demand';
  if (num(r.days_behind) >= 30 && !r.last_reminder_on) return 'Send the reminder';
  if (num(r.days_behind) >= 90) return 'With the debt collector. Chase the update.';
  if (num(r.days_behind) >= 60) return 'Demand is out. Diary the deadline it gave.';
  if (num(r.days_behind) >= 30) return 'Reminder is out. Ring them.';
  return 'Ring them today, before it becomes a letter';
};

async function cmdArrears(db, args, flags) {
  const where = [];
  const params = [];
  if (flags.scheme && flags.scheme !== true) {
    const s = await resolve(db, 'scheme', flags.scheme);
    params.push(s.id);
    where.push(`scheme_id = $${params.length}`);
  }
  if (flags['min-days'] && flags['min-days'] !== true) {
    params.push(Number(flags['min-days']));
    where.push(`days_behind >= $${params.length}`);
  }
  const rows = await db.query(
    `select * from v_arrears ${where.length ? 'where ' + where.join(' and ') : ''} order by days_behind desc`,
    params,
  );
  for (const r of rows) r.next_step = ARREARS_STEP(r);
  const total = rows.reduce((a, r) => a + num(r.arrears_cents), 0);
  const serious = rows.filter((r) => num(r.days_behind) >= 60).length;
  const lines = [
    heading(`Levy arrears (${rows.length} lots, ${money(total)} owing, ${serious} past sixty days)`),
    table(rows, [
      { key: 'lot_ref', label: 'Lot' },
      { key: 'scheme', label: 'Scheme', width: 24 },
      { key: 'owners', label: 'Owner', width: 26 },
      { key: 'arrears_cents', label: 'Owing', align: 'right', format: (v) => money(v) },
      { key: 'days_behind', label: 'Days', align: 'right' },
      { key: 'last_payment_on', label: 'Last paid', format: (v) => isoDate(v) },
      { key: 'next_step', label: 'Next step', width: 48 },
    ]),
  ];
  if (rows.length) {
    lines.push('\n  Where each one has got to');
    for (const r of rows) {
      lines.push(
        `    ${String(r.lot_ref).padEnd(8)} ${String(r.scheme).slice(0, 24).padEnd(25)}` +
          ` reminder ${r.last_reminder_on ? isoDate(r.last_reminder_on) : 'NONE'.padEnd(10)}` +
          `  demand ${r.last_demand_on ? isoDate(r.last_demand_on) : 'NONE'.padEnd(10)}` +
          `  recovery ${r.recovery_started_on ? isoDate(r.recovery_started_on) : 'no'}` +
          `${r.payment_plan_on ? `  plan ${isoDate(r.payment_plan_on)}` : ''}`,
      );
    }
    lines.push(
      '\n  The ladder is the business\'s own: reminder at thirty days, formal demand at sixty, recovery at ninety.',
      '  A levy is recoverable as a debt (Unit Titles Act 2010), and interest, if the body corporate charges it,',
      '  is capped at ten percent a year (Unit Titles Regulations 2011). The file has to show the steps in order.',
    );
  }
  return { text: lines.join('\n'), json: rows };
}

async function cmdArrearsLog(db, args, flags) {
  const [ref, ...rest] = args;
  const l = await resolve(db, 'lot', ref);
  const action = str(flags.action) || rest.join(' ') || 'noted';
  const allowed = ['noted', 'reminder', 'formal demand', 'payment plan', 'debt recovery', 'resolved'];
  if (!allowed.includes(action)) {
    throw new CliError(`Action must be one of: ${allowed.join(', ')}`);
  }
  const [a] = await db.query('select * from v_arrears where lot_id = $1', [l.id]);
  const manager = await whoIs(db, flags);
  const on = parseDate(flags.on) || today();
  const [row] = await db.query(
    `insert into arrears_events (lot_id, noted_on, action, days_behind, amount_cents, manager_id, note)
     values ($1, $2, $3, $4, $5, $6, $7) returning *`,
    [l.id, on, action, a ? num(a.days_behind) : 0, a ? num(a.arrears_cents) : 0, manager?.id ?? null, str(flags.note)],
  );
  return {
    text:
      `Recorded on ${l.ref} (${l.scheme_name}): ${action} on ${on}.` +
      (a ? `\n  ${money(a.arrears_cents)} owing, ${a.days_behind} days behind.\n  Next step: ${ARREARS_STEP({ ...a, [action === 'reminder' ? 'last_reminder_on' : action === 'formal demand' ? 'last_demand_on' : action === 'debt recovery' ? 'recovery_started_on' : 'noted_on']: on })}` : '') +
      '\n  Nothing has been sent by this system. Send the letter yourself and keep the proof.',
    json: row,
  };
}

// ---------------------------------------------------------------------------
// Levies

async function cmdLevies(db, args, flags) {
  const params = [];
  const where = [];
  if (flags.scheme && flags.scheme !== true) {
    const s = await resolve(db, 'scheme', flags.scheme);
    params.push(s.id);
    where.push(`r.scheme_id = $${params.length}`);
  }
  if (!flags.all) where.push("r.due_on >= current_date - 365");
  // FIFO: payments cover the oldest charges first, so a run's outstanding is
  // the part of its charges the lot's payments have not reached yet.
  const rows = await db.query(
    `with lc as (
       select c.id, c.lot_id, c.amount_cents, r.id as run_id,
              sum(c.amount_cents) over (partition by c.lot_id order by r.due_on, r.id) as cum
       from levy_charges c join levy_runs r on r.id = c.levy_run_id
     ),
     paid as (select lot_id, coalesce(sum(amount_cents), 0) as total from levy_payments group by lot_id)
     select r.id, s.code as scheme_code, s.name as scheme, r.fund, r.name, r.struck_on, r.due_on, r.total_cents,
            count(c.id) as lots,
            sum(case when r.due_on > current_date then 0
                     else greatest(0, least(c.amount_cents, lc.cum - coalesce(p.total, 0))) end) as outstanding_cents
     from levy_runs r
     join schemes s on s.id = r.scheme_id
     join levy_charges c on c.levy_run_id = r.id
     join lc on lc.id = c.id
     left join paid p on p.lot_id = c.lot_id
     ${where.length ? 'where ' + where.join(' and ') : ''}
     group by r.id, s.code, s.name, r.fund, r.name, r.struck_on, r.due_on, r.total_cents
     order by s.code, r.due_on desc`,
    params,
  );
  for (const r of rows) {
    r.position = isoDate(r.due_on) > today() ? 'not yet due' : num(r.outstanding_cents) === 0 ? 'collected' : `${money(r.outstanding_cents)} outstanding`;
  }
  const outstanding = rows.reduce((a, r) => a + num(r.outstanding_cents), 0);
  const text =
    heading(`Levy runs (${rows.length}, ${money(outstanding)} outstanding on levies that have fallen due)`) +
    '\n' +
    table(rows, [
      { key: 'scheme_code', label: 'Code' },
      { key: 'scheme', label: 'Scheme', width: 24 },
      { key: 'name', label: 'Levy', width: 24 },
      { key: 'fund', label: 'Fund', width: 11 },
      { key: 'struck_on', label: 'Struck', format: (v) => isoDate(v) },
      { key: 'due_on', label: 'Due', format: (v) => isoDate(v) },
      { key: 'total_cents', label: 'Total', align: 'right', format: (v) => money(v) },
      { key: 'position', label: 'Position', width: 22 },
    ]) +
    '\n\n  The ledger is a record of what was struck and what came in. The money itself sits in the body' +
    '\n  corporate\'s own bank account. Strike a run with: levy strike <scheme> --fund= --total= --due=';
  return { text, json: rows };
}

async function cmdLevy(db, args, flags) {
  const [verb, ...rest] = args;
  if (verb === 'strike') {
    const s = await resolve(db, 'scheme', rest.join(' '));
    const total = parseMoney(flags.total);
    const due = parseDate(flags.due);
    if (!total || !due) throw new CliError('levy strike <scheme> --fund=operating|maintenance --total=16800 --due=YYYY-MM-DD [--name=] [--struck=]');
    const fund = str(flags.fund) || 'operating';
    if (!['operating', 'maintenance'].includes(fund)) throw new CliError('--fund must be operating or maintenance');
    const name = str(flags.name) || `${fund === 'operating' ? 'Operating' : 'Maintenance fund'} levy due ${due}`;
    const [run] = await db.query(
      `insert into levy_runs (scheme_id, fund, name, struck_on, due_on, total_cents, note)
       values ($1, $2, $3, $4, $5, $6, $7) returning *`,
      [s.id, fund, name, parseDate(flags.struck) || today(), due, total, str(flags.note)],
    );
    const charges = await db.query(
      `insert into levy_charges (levy_run_id, lot_id, amount_cents)
       select $1, l.id, round($2::numeric * l.utility_interest / si.total_interest)::bigint
       from lots l
       join (select scheme_id, sum(utility_interest) as total_interest from lots where status = 'active' group by scheme_id) si
         on si.scheme_id = l.scheme_id
       where l.scheme_id = $3 and l.status = 'active'
       returning *`,
      [run.id, total, s.id],
    );
    const amounts = charges.map((c) => num(c.amount_cents));
    return {
      text:
        `${name} struck for ${s.name}: ${money(total)} to the ${fund} fund, due ${due}.\n` +
        `  Split across ${charges.length} lots by utility interest, from ${price(Math.min(...amounts))} to ${price(Math.max(...amounts))}.\n` +
        '  A levy is struck by resolution. Record the motion on the meeting that passed it.\n' +
        '  Render the notices with: npm run docs -- levy-notice',
      json: { run, charges },
    };
  }
  if (verb === 'paid') {
    const l = await resolve(db, 'lot', rest.join(' '));
    const amount = parseMoney(flags.amount);
    if (!amount) throw new CliError('levy paid <lot> --amount=1018 [--on=] [--reference=]');
    const on = parseDate(flags.on) || today();
    const [row] = await db.query(
      `insert into levy_payments (lot_id, paid_on, amount_cents, method, reference, note)
       values ($1, $2, $3, $4, $5, $6) returning *`,
      [l.id, on, amount, str(flags.method) || 'direct credit', str(flags.reference) || l.ref, str(flags.note)],
    );
    const [a] = await db.query('select * from v_arrears where lot_id = $1', [l.id]);
    return {
      text:
        `Receipt of ${price(amount)} recorded on ${l.ref} for ${on}.\n` +
        (a ? `  ${money(a.arrears_cents)} still owing, ${a.days_behind} days behind.` : '  The lot is up to date.') +
        '\n  This is a record. The money itself lands in the body corporate\'s bank account.',
      json: row,
    };
  }
  throw new CliError('levy strike <scheme> --fund= --total= --due=  |  levy paid <lot> --amount=');
}

// ---------------------------------------------------------------------------
// Meetings

async function cmdMeetingsDue(db, args, flags) {
  const rows = await db.query('select * from v_agm_position order by days_to_deadline');
  for (const r of rows) {
    r.position = r.agm_held_this_year
      ? 'held'
      : r.agm_booked
        ? `booked ${isoDate(r.next_meeting_on)}`
        : num(r.days_to_deadline) < 0
          ? `${-r.days_to_deadline} days OVERDUE`
          : `${r.days_to_deadline} days left, nothing booked`;
    r.notice_position = !r.next_meeting_on
      ? ''
      : r.notice_sent_on === null
        ? 'NO NOTICE'
        : `${r.notice_days} days${num(r.notice_days) < 14 ? ' SHORT' : ''}`;
  }
  const overdue = rows.filter((r) => !r.agm_held_this_year && !r.agm_booked && num(r.days_to_deadline) < 0);
  const lines = [
    heading(`The AGM season (${rows.length} schemes, ${overdue.length} past the statutory deadline)`),
    table(rows, [
      { key: 'scheme_code', label: 'Code' },
      { key: 'scheme', label: 'Scheme', width: 26 },
      { key: 'last_fy_end_on', label: 'FY ended', format: (v) => isoDate(v) },
      { key: 'agm_deadline', label: 'AGM by', format: (v) => isoDate(v) },
      { key: 'last_agm_on', label: 'Last AGM', format: (v) => isoDate(v) },
      { key: 'position', label: 'Position', width: 26 },
      { key: 'next_meeting_kind', label: 'Next', width: 10 },
      { key: 'next_meeting_on', label: 'Booked for', format: (v) => isoDate(v) },
      { key: 'notice_position', label: 'Notice', width: 12 },
      { key: 'manager', label: 'Manager', width: 13 },
    ]),
    '',
    '  An AGM must be held within six months of the end of the financial year (Unit Titles Act 2010 s 89).',
    '  Written notice of a general meeting goes to every owner at least fourteen days before it.',
    '  Book one with: meeting schedule <scheme> --kind=AGM --on=YYYY-MM-DD',
  ];
  return { text: lines.join('\n'), json: rows };
}

async function cmdMeetings(db, args, flags) {
  const params = [];
  const where = [];
  if (!flags.all) where.push('(mt.held_on is null or mt.held_on >= current_date - 365)');
  if (flags.scheme && flags.scheme !== true) {
    const s = await resolve(db, 'scheme', flags.scheme);
    params.push(s.id);
    where.push(`mt.scheme_id = $${params.length}`);
  }
  const rows = await db.query(
    `select mt.*, s.code as scheme_code, s.name as scheme,
            (select count(*) from motions mo where mo.meeting_id = mt.id) as motions,
            (select count(*) from motions mo where mo.meeting_id = mt.id and mo.result = 'pending') as pending_motions,
            case when mt.scheduled_on is null or mt.notice_sent_on is null then null
                 else (mt.scheduled_on - mt.notice_sent_on) end as notice_days
     from meetings mt join schemes s on s.id = mt.scheme_id
     ${where.length ? 'where ' + where.join(' and ') : ''}
     order by coalesce(mt.held_on, mt.scheduled_on) desc`,
    params,
  );
  const text =
    heading(`Meetings (${rows.length})`) +
    '\n' +
    table(rows, [
      { key: 'id', label: 'Id', format: (v) => short(v) },
      { key: 'scheme', label: 'Scheme', width: 26 },
      { key: 'kind', label: 'Kind', width: 10 },
      { key: 'scheduled_on', label: 'Booked', format: (v) => isoDate(v) },
      { key: 'notice_days', label: 'Notice', align: 'right', format: (v, r) => (r.scheduled_on ? (v === null ? 'NONE' : `${v}d${num(v) < 14 ? ' SHORT' : ''}`) : '') },
      { key: 'held_on', label: 'Held', format: (v) => isoDate(v) },
      { key: 'minutes_sent_on', label: 'Minutes', format: (v, r) => (v ? isoDate(v) : r.held_on ? 'NOT SENT' : '') },
      { key: 'motions', label: 'Motions', align: 'right' },
      { key: 'pending_motions', label: 'Pending', align: 'right' },
    ]);
  return { text, json: rows };
}

const MEETING_VERBS = new Set(['schedule', 'notice', 'held', 'minutes']);

async function cmdMeeting(db, args, flags) {
  const [verb, ...rest] = args;
  if (!verb) throw new CliError('meeting schedule|notice|held|minutes <...>, or `meetings` for the list.');
  if (!MEETING_VERBS.has(verb)) return cmdMeetingShow(db, await resolve(db, 'meeting', args.join(' ')));

  if (verb === 'schedule') {
    const s = await resolve(db, 'scheme', rest.join(' '));
    const on = parseDate(flags.on);
    if (!on) throw new CliError('When: meeting schedule <scheme> --kind=AGM|EGM|committee --on=YYYY-MM-DD');
    const kind = str(flags.kind) || 'AGM';
    const manager = await whoIs(db, flags);
    const [row] = await db.query(
      `insert into meetings (scheme_id, kind, scheduled_on, venue, manager_id, note)
       values ($1, $2, $3, $4, $5, $6) returning *`,
      [s.id, kind, on, str(flags.venue), manager?.id ?? null, str(flags.note)],
    );
    const noticeBy = addDays(on, -14);
    const [agm] = await db.query('select * from v_agm_position where scheme_id = $1', [s.id]);
    let deadlineLine = '';
    if (kind === 'AGM' && agm && agm.agm_deadline) {
      deadlineLine =
        isoDate(agm.agm_deadline) < on
          ? `\n  WARNING: that is after the s 89 deadline of ${isoDate(agm.agm_deadline)}. Hold it anyway, and note why it is late.`
          : `\n  Inside the s 89 deadline of ${isoDate(agm.agm_deadline)}.`;
    }
    return {
      text:
        `${kind} booked for ${s.name} on ${on}.` +
        deadlineLine +
        (kind === 'committee'
          ? ''
          : `\n  Written notice has to reach every owner by ${noticeBy} (fourteen days).\n  Record it with: meeting notice ${short(row.id)} --on=${today()}`) +
        `\n  Add the agenda: motion add ${short(row.id)} "<title>" [--kind=special]`,
      json: row,
    };
  }

  const m = await resolve(db, 'meeting', rest.join(' '));
  const on = parseDate(flags.on) || today();
  if (verb === 'notice') {
    const [row] = await db.query('update meetings set notice_sent_on = $2 where id = $1 returning *', [m.id, on]);
    const days = m.scheduled_on ? Math.round((new Date(isoDate(m.scheduled_on)) - new Date(on)) / 86400000) : null;
    return {
      text:
        `Notice recorded for the ${m.scheme_name} ${m.kind} on ${on}.` +
        (days === null
          ? ''
          : days < 14 && m.kind !== 'committee'
            ? `\n  WARNING: that is ${days} days of notice. A general meeting needs fourteen. Move the meeting or re-issue.`
            : `\n  ${days} days before the meeting.`) +
        '\n  Nothing has been sent by this system. Send the notice and the agenda yourself.',
      json: row,
    };
  }
  if (verb === 'held') {
    const [row] = await db.query(
      'update meetings set held_on = $2, quorum_met = coalesce($3, quorum_met) where id = $1 returning *',
      [m.id, on, flags.quorum === undefined ? null : Boolean(flags.quorum)],
    );
    const pending = await db.query("select * from motions where meeting_id = $1 and result = 'pending' order by number", [m.id]);
    return {
      text:
        `${m.kind} for ${m.scheme_name} recorded as held on ${on}.` +
        (pending.length ? `\n  ${pending.length} motions still marked pending. Record each result: motion result ${short(m.id)} <number> carried|lost --for= --against=` : '') +
        `\n  The minutes have not been sent. Record that with: meeting minutes ${short(m.id)} --on=YYYY-MM-DD`,
      json: row,
    };
  }
  // minutes
  const [row] = await db.query('update meetings set minutes_sent_on = $2 where id = $1 returning *', [m.id, on]);
  return { text: `Minutes for the ${m.scheme_name} ${m.kind} marked sent to owners on ${on}.`, json: row };
}

async function cmdMeetingShow(db, m) {
  const motions = await db.query('select * from motions where meeting_id = $1 order by number', [m.id]);
  const noticeDays =
    m.scheduled_on && m.notice_sent_on ? Math.round((new Date(isoDate(m.scheduled_on)) - new Date(isoDate(m.notice_sent_on))) / 86400000) : null;
  const lines = [
    heading(`${m.kind}  ${m.scheme_name}`),
    `  Booked       ${isoDate(m.scheduled_on) || 'not booked'}`,
    `  Notice sent  ${isoDate(m.notice_sent_on) || 'NOT SENT'}${noticeDays !== null ? ` (${noticeDays} days${noticeDays < 14 && m.kind !== 'committee' ? ', SHORT of fourteen' : ''})` : ''}`,
    `  Held         ${isoDate(m.held_on) || 'not yet'}${m.quorum_met === null || m.quorum_met === undefined ? '' : m.quorum_met ? ', quorum met' : ', NO QUORUM'}`,
    `  Minutes      ${isoDate(m.minutes_sent_on) || (m.held_on ? 'NOT SENT' : '')}`,
    `  Venue        ${m.venue || ''}`,
    `  Note         ${m.note || ''}`,
    '',
    table(motions, [
      { key: 'number', label: 'No', align: 'right' },
      { key: 'title', label: 'Motion', width: 56, format: (v) => truncate(v, 56) },
      { key: 'kind', label: 'Kind', width: 9 },
      { key: 'result', label: 'Result', width: 9 },
      { key: 'votes_for', label: 'For', align: 'right' },
      { key: 'votes_against', label: 'Against', align: 'right' },
      { key: 'abstained', label: 'Abst', align: 'right' },
    ]),
  ];
  return { text: lines.join('\n'), json: { meeting: m, motions } };
}

async function cmdMotion(db, args, flags) {
  const [verb, ...rest] = args;
  if (verb === 'add') {
    const [mref, ...titleParts] = rest;
    const m = await resolve(db, 'meeting', mref);
    const title = titleParts.join(' ');
    if (!title) throw new CliError('motion add <meeting> "<title>" [--kind=ordinary|special] [--detail=]');
    const [{ next }] = await db.query('select coalesce(max(number), 0) + 1 as next from motions where meeting_id = $1', [m.id]);
    const [row] = await db.query(
      `insert into motions (meeting_id, number, title, detail, kind) values ($1, $2, $3, $4, $5) returning *`,
      [m.id, next, title, str(flags.detail), str(flags.kind) || 'ordinary'],
    );
    return {
      text:
        `Motion ${row.number} added to the ${m.scheme_name} ${m.kind}: ${title} (${row.kind} resolution).` +
        (row.kind === 'special' ? '\n  A special resolution needs a 75 percent majority of votes cast.' : ''),
      json: row,
    };
  }
  if (verb === 'result') {
    const [mref, numArg, result] = rest;
    const m = await resolve(db, 'meeting', mref);
    if (!['carried', 'lost', 'withdrawn'].includes(result)) throw new CliError('motion result <meeting> <number> carried|lost|withdrawn [--for= --against= --abstained=]');
    const [row] = await db.query(
      `update motions set result = $3, votes_for = $4, votes_against = $5, abstained = $6
       where meeting_id = $1 and number = $2 returning *`,
      [m.id, Number(numArg), result, flags.for === undefined ? null : Number(flags.for), flags.against === undefined ? null : Number(flags.against), flags.abstained === undefined ? null : Number(flags.abstained)],
    );
    if (!row) throw new CliError(`No motion ${numArg} on that meeting.`);
    return { text: `Motion ${row.number} (${truncate(row.title, 50)}): ${result}${row.votes_for !== null ? `, ${row.votes_for} for, ${row.votes_against || 0} against` : ''}.`, json: row };
  }
  throw new CliError('motion add <meeting> "<title>"  |  motion result <meeting> <number> carried|lost|withdrawn');
}

// ---------------------------------------------------------------------------
// Maintenance and contractor jobs

async function cmdMaintenance(db, args, flags) {
  const [verb, ...rest] = args;
  const VERBS = new Set(['new', 'ask', 'approve', 'decline', 'complete']);
  if (verb && VERBS.has(verb)) return cmdMaintenanceWrite(db, verb, rest, flags);
  if (verb) return cmdMaintenanceShow(db, await resolve(db, 'maintenance', args.join(' ')));

  const where = [];
  const params = [];
  if (flags.scheme && flags.scheme !== true) {
    const s = await resolve(db, 'scheme', flags.scheme);
    params.push(s.id);
    where.push(`scheme_id = $${params.length}`);
  }
  if (flags.urgent) where.push("(priority = 'urgent' or habitability)");
  const rows = flags.all
    ? await db.query(
        `select mr.id as maintenance_id, coalesce(mr.job_ref, '') as job_ref, s.code as scheme_code, s.name as scheme,
                mr.reported_on, (current_date - mr.reported_on) as days_open, mr.category, mr.priority, mr.summary,
                mr.status, mr.habitability, coalesce(m.full_name, 'unassigned') as manager
         from maintenance_requests mr join schemes s on s.id = mr.scheme_id
         left join managers m on m.id = mr.manager_id order by mr.reported_on desc`,
      )
    : await db.query(
        `select * from v_maintenance_open ${where.length ? 'where ' + where.join(' and ') : ''}
         order by case priority when 'urgent' then 1 when 'high' then 2 when 'normal' then 3 else 4 end, days_open desc`,
        params,
      );
  const waiting = rows.filter((r) => num(r.days_waiting_on_committee) > 0).length;
  const text =
    heading(`Maintenance ${flags.all ? '(everything)' : 'open'} (${rows.length}${waiting ? `, ${waiting} waiting on a committee` : ''})`) +
    '\n' +
    table(rows, [
      { key: 'job_ref', label: 'Ref' },
      { key: 'scheme', label: 'Scheme', width: 24 },
      { key: 'priority', label: 'Priority', width: 8 },
      { key: 'category', label: 'Category', width: 10 },
      { key: 'summary', label: 'What', width: 44, format: (v) => truncate(v, 44) },
      { key: 'status', label: 'Status', width: 26 },
      { key: 'days_open', label: 'Days', align: 'right' },
      { key: 'days_waiting_on_committee', label: 'Cttee', align: 'right', format: (v) => (v === null || v === undefined ? '' : `${v}d`) },
      { key: 'contractor', label: 'Contractor', width: 22 },
      { key: 'quoted_cents', label: 'Quoted', align: 'right', format: (v) => (num(v) ? money(v) : '') },
    ]);
  return { text, json: rows };
}

async function cmdMaintenanceWrite(db, verb, args, flags) {
  const manager = await whoIs(db, flags);
  if (verb === 'new') {
    const [schemeRef, ...summaryParts] = args;
    const s = await resolve(db, 'scheme', schemeRef);
    const summary = summaryParts.join(' ');
    if (!summary) throw new CliError('maintenance new <scheme> "<what is wrong>" [--priority=urgent|high|normal|low] [--category=] [--lot=] [--habitability]');
    const lot = flags.lot && flags.lot !== true ? await resolve(db, 'lot', flags.lot) : null;
    const [{ next }] = await db.query("select 'MNT-' || (3000 + count(*) + 1)::text as next from maintenance_requests");
    const [row] = await db.query(
      `insert into maintenance_requests (job_ref, scheme_id, lot_id, reported_on, reported_by, category, priority,
                                         summary, detail, status, habitability, committee_approval_required, manager_id, note)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'new', $10, $11, $12, $13) returning *`,
      [
        next, s.id, lot?.id ?? null, parseDate(flags.on) || today(), str(flags['reported-by']) || 'owner',
        str(flags.category) || 'general', str(flags.priority) || 'normal', summary, str(flags.detail),
        Boolean(flags.habitability), flags['no-approval'] ? false : true, manager?.id ?? null, str(flags.note),
      ],
    );
    return {
      text:
        `${row.job_ref} raised at ${s.name}: ${summary}\n` +
        `  Priority ${row.priority}${row.habitability ? ', habitability' : ''}. ` +
        (row.committee_approval_required
          ? `The committee has to approve it (delegated limit ${money(s.committee_spend_limit_cents)}).`
          : 'No committee approval needed.') +
        `\n  Next: maintenance ask ${row.job_ref} --quote=  then  job issue ${row.job_ref} "<contractor>"`,
      json: row,
    };
  }

  const m = await resolve(db, 'maintenance', args.join(' '));
  const on = parseDate(flags.on) || today();
  if (verb === 'ask') {
    const quote = parseMoney(flags.quote);
    const [row] = await db.query(
      `update maintenance_requests set committee_asked_on = $2, status = 'awaiting committee approval',
              approval_limit_cents = case when $3 > 0 then $3 else approval_limit_cents end
       where id = $1 returning *`,
      [m.id, on, quote],
    );
    const overLimit = quote > num(m.committee_spend_limit_cents) && num(m.committee_spend_limit_cents) > 0;
    return {
      text:
        `${m.job_ref || short(m.id)} put to the ${m.scheme_name} committee on ${on}${quote ? ` with a quote of ${money(quote)}` : ''}.` +
        (overLimit ? `\n  That is over the committee's ${money(m.committee_spend_limit_cents)} delegation. It needs a resolution, not a nod: record it with --ref when you approve.` : '') +
        '\n  Nothing has been sent by this system; write to them yourself.',
      json: row,
    };
  }
  if (verb === 'approve') {
    const [row] = await db.query(
      `update maintenance_requests set committee_approved_on = $2, status = 'approved',
              approval_ref = coalesce(nullif($3, ''), approval_ref),
              approval_limit_cents = case when $4 > 0 then $4 else approval_limit_cents end
       where id = $1 returning *`,
      [m.id, on, str(flags.ref), parseMoney(flags.limit)],
    );
    return {
      text:
        `${m.job_ref || short(m.id)} approved by the committee on ${on}${row.approval_ref ? ` (${row.approval_ref})` : ''}.` +
        (row.approval_ref ? '' : '\n  No resolution reference recorded. An approval is evidence of a decision; add --ref="Flying minute 2026-XX" next time.') +
        `\n  Send someone: job issue ${m.job_ref || short(m.id)} "<contractor>"`,
      json: row,
    };
  }
  if (verb === 'decline') {
    const [row] = await db.query(
      "update maintenance_requests set status = 'declined', closed_on = $2, note = coalesce(nullif($3, ''), note) where id = $1 returning *",
      [m.id, on, args.length > 1 ? args.slice(1).join(' ') : str(flags.note)],
    );
    return { text: `${m.job_ref || short(m.id)} declined by the committee on ${on}. Tell whoever reported it why.`, json: row };
  }
  // complete
  const [row] = await db.query(
    "update maintenance_requests set status = 'completed', completed_on = $2, closed_on = $2 where id = $1 returning *",
    [m.id, on],
  );
  return { text: `${m.job_ref || short(m.id)} completed on ${on} at ${m.scheme_name}.`, json: row };
}

async function cmdMaintenanceShow(db, m) {
  const jobs = await db.query(
    `select j.*, c.name as contractor_name, c.trade, c.phone from contractor_jobs j
     left join contractors c on c.id = j.contractor_id where j.maintenance_id = $1 order by j.issued_on`,
    [m.id],
  );
  const lines = [
    heading(`${m.job_ref || short(m.id)}  ${m.scheme_code}  ${m.scheme_name}`),
    `  Reported     ${isoDate(m.reported_on)} by the ${m.reported_by}, ${Math.round((Date.now() - new Date(isoDate(m.reported_on))) / 86400000)} days ago`,
    `  What         ${m.summary}`,
    `  Detail       ${m.detail || ''}`,
    `  Category     ${m.category}, priority ${m.priority}${m.habitability ? ', HABITABILITY' : ''}`,
    `  Status       ${m.status}`,
    `  Committee    ${m.committee_approval_required ? `approval required (delegation ${money(m.committee_spend_limit_cents)})` : 'no approval needed'}`,
    `  Asked        ${isoDate(m.committee_asked_on) || 'not asked'}`,
    `  Approved     ${isoDate(m.committee_approved_on) || 'not approved'}${m.approval_ref ? ` (${m.approval_ref})` : ''}${num(m.approval_limit_cents) ? ` up to ${money(m.approval_limit_cents)}` : ''}`,
    `  Completed    ${isoDate(m.completed_on) || 'not yet'}`,
    `  Note         ${m.note || ''}`,
    '',
    table(jobs, [
      { key: 'job_no', label: 'Job' },
      { key: 'contractor_name', label: 'Contractor', width: 26 },
      { key: 'trade', label: 'Trade', width: 10 },
      { key: 'issued_on', label: 'Issued', format: (v) => isoDate(v) },
      { key: 'scheduled_on', label: 'Booked', format: (v) => isoDate(v) },
      { key: 'completed_on', label: 'Done', format: (v) => isoDate(v) },
      { key: 'quoted_cents', label: 'Quoted', align: 'right', format: (v) => (num(v) ? price(v) : '') },
      { key: 'invoiced_cents', label: 'Invoiced', align: 'right', format: (v) => (num(v) ? price(v) : '') },
      { key: 'status', label: 'Status', width: 10 },
    ]),
  ];
  return { text: lines.join('\n'), json: { maintenance: m, jobs } };
}

async function cmdJobs(db, args, flags) {
  const where = flags.all ? '' : 'where j.completed_on is null or j.invoiced_on is null';
  const rows = await db.query(
    `select j.job_no, coalesce(c.name, 'unassigned') as contractor, c.trade, s.code as scheme_code, s.name as scheme,
            mr.job_ref, mr.summary, j.issued_on, j.scheduled_on, j.completed_on, j.invoiced_on, j.quoted_cents,
            j.invoiced_cents, j.status
     from contractor_jobs j
     join maintenance_requests mr on mr.id = j.maintenance_id
     join schemes s on s.id = mr.scheme_id
     left join contractors c on c.id = j.contractor_id
     ${where}
     order by j.issued_on desc nulls last`,
  );
  const text =
    heading(`Contractor jobs (${rows.length}${flags.all ? '' : ', open or not yet invoiced'})`) +
    '\n' +
    table(rows, [
      { key: 'job_no', label: 'Job' },
      { key: 'contractor', label: 'Contractor', width: 26 },
      { key: 'scheme', label: 'Scheme', width: 24 },
      { key: 'summary', label: 'What', width: 40, format: (v) => truncate(v, 40) },
      { key: 'issued_on', label: 'Issued', format: (v) => isoDate(v) },
      { key: 'scheduled_on', label: 'Booked', format: (v) => isoDate(v) },
      { key: 'completed_on', label: 'Done', format: (v) => isoDate(v) },
      { key: 'quoted_cents', label: 'Quoted', align: 'right', format: (v) => (num(v) ? price(v) : '') },
      { key: 'invoiced_cents', label: 'Invoiced', align: 'right', format: (v, r) => (num(v) ? price(v) : r.completed_on ? 'NO INVOICE' : '') },
      { key: 'status', label: 'Status', width: 10 },
    ]);
  return { text, json: rows };
}

const JOB_VERBS = new Set(['issue', 'book', 'done', 'invoice', 'cancel']);

async function cmdJob(db, args, flags) {
  const [verb, ...rest] = args;
  if (!verb) throw new CliError('job issue|book|done|invoice|cancel <...>, or `jobs` for the list.');
  if (!JOB_VERBS.has(verb)) {
    const j = await resolve(db, 'job', args.join(' '));
    const m = await resolve(db, 'maintenance', j.maintenance_id);
    return cmdMaintenanceShow(db, m);
  }

  if (verb === 'issue') {
    const [mref, ...who] = rest;
    const m = await resolve(db, 'maintenance', mref);
    const c = await resolve(db, 'contractor', who.join(' ') || flags.contractor);
    if (m.committee_approval_required && !m.committee_approved_on && !flags.force) {
      throw new CliError(
        `${m.job_ref || short(m.id)} has not been approved by the committee. Ask first (maintenance ask ${m.job_ref}),\n` +
          '  or pass --force only for emergency work under the manager\'s delegated authority, and say why in --note.',
      );
    }
    const [{ next }] = await db.query("select 'JOB-' || (4000 + count(*) + 1)::text as next from contractor_jobs");
    const [row] = await db.query(
      `insert into contractor_jobs (job_no, maintenance_id, contractor_id, issued_on, scheduled_on, quoted_cents, status, note)
       values ($1, $2, $3, $4, $5, $6, 'issued', $7) returning *`,
      [next, m.id, c.id, parseDate(flags.on) || today(), parseDate(flags.scheduled), parseMoney(flags.quote), str(flags.note)],
    );
    await db.query("update maintenance_requests set status = 'scheduled' where id = $1", [m.id]);
    return {
      text:
        `${row.job_no} issued to ${c.name} (${c.trade}${c.phone ? `, ${c.phone}` : ''}) for ${m.job_ref || short(m.id)} at ${m.scheme_name}.\n` +
        `  ${m.summary}\n` +
        (row.scheduled_on ? `  Booked for ${isoDate(row.scheduled_on)}.` : '  No date booked yet: job book ' + row.job_no + ' --on=YYYY-MM-DD') +
        '\n  Nothing has been emailed. Send the work order yourself.',
      json: row,
    };
  }

  const j = await resolve(db, 'job', rest.join(' '));
  const on = parseDate(flags.on) || today();
  if (verb === 'book') {
    const [row] = await db.query("update contractor_jobs set scheduled_on = $2, status = 'scheduled' where id = $1 returning *", [j.id, on]);
    return { text: `${j.job_no} booked for ${on} at ${j.scheme_name}. Tell the residents if it affects access.`, json: row };
  }
  if (verb === 'done') {
    const [row] = await db.query("update contractor_jobs set completed_on = $2, status = 'done' where id = $1 returning *", [j.id, on]);
    if (flags.complete) await db.query("update maintenance_requests set status = 'completed', completed_on = $2, closed_on = $2 where id = $1", [j.maintenance_id, on]);
    return { text: `${j.job_no} finished ${on}. Waiting on the invoice.${flags.complete ? ' The maintenance request is closed.' : ''}`, json: row };
  }
  if (verb === 'invoice') {
    const amount = parseMoney(flags.amount);
    if (!amount) throw new CliError('job invoice <job> --amount=517.50 [--ref=INV-1234]');
    const [row] = await db.query(
      "update contractor_jobs set invoiced_cents = $2, invoiced_on = $3, invoice_ref = $4, status = 'invoiced' where id = $1 returning *",
      [j.id, amount, on, str(flags.ref) || null],
    );
    const over = num(j.quoted_cents) && amount > num(j.quoted_cents) * 1.1;
    return {
      text:
        `${j.job_no} invoiced ${price(amount)} on ${on}${row.invoice_ref ? ` (${row.invoice_ref})` : ''}.` +
        (over ? `\n  That is more than ten percent over the ${price(j.quoted_cents)} quote. Check it before it hits the body corporate's account.` : '') +
        '\n  This is a record. The invoice itself gets paid from the body corporate\'s bank account.',
      json: row,
    };
  }
  const [row] = await db.query("update contractor_jobs set status = 'cancelled' where id = $1 returning *", [j.id]);
  return { text: `${j.job_no} cancelled.`, json: row };
}

async function cmdContractors(db, args, flags) {
  const rows = await db.query(
    `select c.*, (select count(*) from contractor_jobs j where j.contractor_id = c.id) as jobs,
            (select count(*) from contractor_jobs j where j.contractor_id = c.id and j.completed_on is null) as open_jobs,
            (select coalesce(sum(j.invoiced_cents), 0) from contractor_jobs j where j.contractor_id = c.id and j.invoiced_on >= current_date - 365) as spend_12m
     from contractors c ${flags.all ? '' : 'where c.active'} order by c.trade, c.name`,
  );
  const text =
    heading(`Contractors (${rows.length})`) +
    '\n' +
    table(rows, [
      { key: 'name', label: 'Contractor', width: 28 },
      { key: 'trade', label: 'Trade', width: 11 },
      { key: 'contact_name', label: 'Contact', width: 16 },
      { key: 'phone', label: 'Phone', width: 13 },
      { key: 'licence_ref', label: 'Licence', width: 12 },
      { key: 'insurance_expires_on', label: 'Insurance', format: (v) => (v && isoDate(v) < today() ? `EXPIRED ${isoDate(v)}` : isoDate(v)) },
      { key: 'open_jobs', label: 'Open', align: 'right' },
      { key: 'spend_12m', label: 'Spend 12m', align: 'right', format: (v) => money(v) },
      { key: 'preferred', label: 'Preferred', format: (v) => (v ? 'yes' : '') },
    ]);
  return { text, json: rows };
}

// ---------------------------------------------------------------------------
// Insurance

async function cmdInsurance(db, args, flags) {
  const [verb, ...rest] = args;
  if (verb === 'renew') {
    const p = await resolve(db, 'policy', rest.join(' '));
    const expires = parseDate(flags.expires);
    if (!expires) throw new CliError('insurance renew <policy> --expires=YYYY-MM-DD [--premium=] [--sum=] [--insurer=]');
    const [row] = await db.query(
      `update insurance_policies set expires_on = $2, started_on = $3,
              premium_cents = case when $4 > 0 then $4 else premium_cents end,
              sum_insured_cents = case when $5 > 0 then $5 else sum_insured_cents end,
              insurer = coalesce(nullif($6, ''), insurer)
       where id = $1 returning *`,
      [p.id, expires, parseDate(flags.started) || today(), parseMoney(flags.premium), parseMoney(flags.sum), str(flags.insurer)],
    );
    return {
      text: `${p.scheme_name} ${p.kind} policy renewed to ${expires}${num(flags.premium ? parseMoney(flags.premium) : 0) ? ` at ${money(parseMoney(flags.premium))}` : ''}.`,
      json: row,
    };
  }
  if (verb === 'valuation') {
    const s = await resolve(db, 'scheme', rest.join(' '));
    const amount = parseMoney(flags.amount);
    if (!amount) throw new CliError('insurance valuation <scheme> --amount=14200000 [--on=]');
    const on = parseDate(flags.on) || today();
    const [row] = await db.query(
      `update insurance_policies set valuation_cents = $2, valuation_on = $3
       where scheme_id = $1 and kind = 'principal' returning *`,
      [s.id, amount, on],
    );
    if (!row) throw new CliError(`${s.name} has no principal policy on file. Add one first.`);
    await db.query(
      `update compliance_items set status = 'compliant', assessed_on = $2, done_on = $2
       where scheme_id = $1 and kind = 'insurance replacement valuation'`,
      [s.id, on],
    );
    const short_ = amount > num(row.sum_insured_cents);
    return {
      text:
        `Replacement valuation of ${money(amount)} recorded for ${s.name} as at ${on}.` +
        (short_
          ? `\n  The sum insured on the policy is ${money(row.sum_insured_cents)}. That is now UNDER the valuation. Tell the broker today: the Act requires full replacement value (UTA 2010 s 135).`
          : `\n  The sum insured of ${money(row.sum_insured_cents)} covers it.`),
      json: row,
    };
  }
  const params = [];
  const where = [];
  if (flags.scheme && flags.scheme !== true) {
    const s = await resolve(db, 'scheme', flags.scheme);
    params.push(s.id);
    where.push(`scheme_id = $${params.length}`);
  }
  if (flags.expired) where.push('days_to_expiry < 0');
  const rows = await db.query(
    `select * from v_insurance_position ${where.length ? 'where ' + where.join(' and ') : ''} order by days_to_expiry nulls last`,
    params,
  );
  const expired = rows.filter((r) => num(r.days_to_expiry) < 0).length;
  const stale = rows.filter((r) => r.kind === 'principal' && (r.valuation_on === null || num(r.valuation_age_days) > 1095)).length;
  const lines = [
    heading(`The insurance programme (${rows.length} policies${expired ? `, ${expired} EXPIRED` : ''}${stale ? `, ${stale} on a stale valuation` : ''})`),
    table(rows, [
      { key: 'scheme_code', label: 'Code' },
      { key: 'scheme', label: 'Scheme', width: 24 },
      { key: 'kind', label: 'Policy', width: 15 },
      { key: 'insurer', label: 'Insurer', width: 10 },
      { key: 'policy_number', label: 'Number', width: 10 },
      { key: 'sum_insured_cents', label: 'Sum insured', align: 'right', format: (v) => (num(v) ? money(v) : '') },
      { key: 'valuation_on', label: 'Valuation', format: (v, r) => (v ? `${isoDate(v)}${num(r.valuation_age_days) > 1095 ? ' STALE' : ''}` : r.kind === 'principal' ? 'NONE' : '') },
      { key: 'expires_on', label: 'Expires', format: (v, r) => (num(r.days_to_expiry) < 0 ? `EXPIRED ${isoDate(v)}` : isoDate(v)) },
      { key: 'premium_cents', label: 'Premium', align: 'right', format: (v) => (num(v) ? money(v) : '') },
      { key: 'manager', label: 'Manager', width: 13 },
    ]),
    '',
    '  A body corporate must hold principal insurance at full replacement value (Unit Titles Act 2010 s 135).',
    '  A valuation over three years old is this business\'s own line for "the sum insured is a guess".',
    '  Record a renewal: insurance renew <policy> --expires=   A new valuation: insurance valuation <scheme> --amount=',
  ];
  return { text: lines.join('\n'), json: rows };
}

// ---------------------------------------------------------------------------
// Disclosures

async function cmdDisclosures(db, args, flags) {
  if (flags.all) {
    const rows = await db.query(
      `select d.*, s.code as scheme_code, s.name as scheme, coalesce(l.ref, '') as lot_ref,
              working_days_between(d.requested_on, coalesce(d.provided_on, current_date)) as working_days
       from disclosure_requests d join schemes s on s.id = d.scheme_id left join lots l on l.id = d.lot_id
       order by d.requested_on desc`,
    );
    const text =
      heading(`Disclosures (${rows.length})`) +
      '\n' +
      table(rows, [
        { key: 'lot_ref', label: 'Lot' },
        { key: 'scheme', label: 'Scheme', width: 24 },
        { key: 'kind', label: 'Kind', width: 15 },
        { key: 'requested_on', label: 'Requested', format: (v) => isoDate(v) },
        { key: 'requested_by', label: 'By', width: 38, format: (v) => truncate(v, 38) },
        { key: 'working_days', label: 'Wk days', align: 'right' },
        { key: 'provided_on', label: 'Provided', format: (v) => (v ? isoDate(v) : 'OPEN') },
      ]);
    return { text, json: rows };
  }
  const rows = await db.query('select * from v_disclosures_open order by working_days_open desc');
  const overdue = rows.filter((r) => num(r.working_days_open) > 5).length;
  const lines = [
    heading(`Disclosure requests open (${rows.length}${overdue ? `, ${overdue} past the five working days` : ''})`),
    table(rows, [
      { key: 'lot_ref', label: 'Lot' },
      { key: 'scheme', label: 'Scheme', width: 24 },
      { key: 'owners', label: 'Owner', width: 24 },
      { key: 'kind', label: 'Kind', width: 15 },
      { key: 'requested_on', label: 'Requested', format: (v) => isoDate(v) },
      { key: 'working_days_open', label: 'Wk days', align: 'right', format: (v) => `${v}${num(v) > 5 ? ' LATE' : ''}` },
      { key: 'requested_by', label: 'By', width: 40, format: (v) => truncate(v, 40) },
      { key: 'manager', label: 'Manager', width: 13 },
    ]),
    '',
    '  A pre-settlement disclosure statement is due within five working days of the request (UTA 2010 s 147).',
    '  A pre-contract statement must reach the buyer before they sign (s 146). Mark one done with:',
    '  disclosure provide <lot> [--on=]',
  ];
  return { text: lines.join('\n'), json: rows };
}

async function cmdDisclosure(db, args, flags) {
  const [verb, ...rest] = args;
  if (verb === 'request') {
    const l = await resolve(db, 'lot', rest.join(' '));
    const manager = await whoIs(db, flags);
    const on = parseDate(flags.on) || today();
    const kind = str(flags.kind) || 'pre-settlement';
    const [row] = await db.query(
      `insert into disclosure_requests (scheme_id, lot_id, kind, requested_on, requested_by, manager_id, note)
       values ($1, $2, $3, $4, $5, $6, $7) returning *`,
      [l.scheme_id, l.id, kind, on, str(flags.by), manager?.id ?? null, str(flags.note)],
    );
    return {
      text:
        `${kind} disclosure recorded for ${l.ref} (${l.scheme_name}), requested ${on}.` +
        (kind === 'pre-settlement' ? `\n  Five working days: it has to be provided by ${addWorkingDays(on, 5)} (UTA 2010 s 147).` : ''),
      json: row,
    };
  }
  if (verb === 'provide') {
    const d = await resolve(db, 'disclosure', rest.join(' '));
    if (d.provided_on) throw new CliError(`That disclosure was already provided on ${isoDate(d.provided_on)}.`);
    const on = parseDate(flags.on) || today();
    const [row] = await db.query('update disclosure_requests set provided_on = $2 where id = $1 returning *', [d.id, on]);
    const wd = await db.query('select working_days_between($1::date, $2::date) as wd', [isoDate(d.requested_on), on]);
    const days = num(wd[0].wd);
    return {
      text:
        `${d.kind} disclosure for ${d.lot_ref || d.scheme_name} marked provided on ${on}, ${days} working days after the request.` +
        (d.kind === 'pre-settlement' && days > 5 ? ' That is OUTSIDE the five working days the Act gives (s 147). Note why on the file.' : ''),
      json: row,
    };
  }
  throw new CliError('disclosure request <lot> [--kind=pre-contract|pre-settlement] [--by=]  |  disclosure provide <lot|id> [--on=]');
}

// ---------------------------------------------------------------------------
// Compliance items and the rule check

async function cmdComplianceItems(db, args, flags) {
  const params = [];
  const where = [];
  if (flags.scheme && flags.scheme !== true) {
    const s = await resolve(db, 'scheme', flags.scheme);
    params.push(s.id);
    where.push(`scheme_id = $${params.length}`);
  }
  if (!flags.all) where.push("status not in ('compliant', 'exempt')");
  if (flags.kind && flags.kind !== true) {
    params.push(`%${flags.kind}%`);
    where.push(`kind ilike $${params.length}`);
  }
  const rows = await db.query(
    `select * from v_compliance_due ${where.length ? 'where ' + where.join(' and ') : ''}
     order by case status when 'not compliant' then 1 when 'unknown' then 2 when 'exempt' then 3 else 4 end, days_overdue desc nulls last`,
    params,
  );
  const bad = rows.filter((r) => r.status === 'not compliant').length;
  const lines = [
    heading(`Compliance items (${rows.length}${bad ? `, ${bad} not compliant` : ''})`),
    table(rows, [
      { key: 'scheme_code', label: 'Code' },
      { key: 'scheme', label: 'Scheme', width: 24 },
      { key: 'kind', label: 'Item', width: 34 },
      { key: 'status', label: 'Status', width: 14 },
      { key: 'assessed_on', label: 'Assessed', format: (v) => isoDate(v) },
      { key: 'due_on', label: 'Due', format: (v) => isoDate(v) },
      { key: 'days_overdue', label: 'Overdue', align: 'right', format: (v) => (num(v) > 0 ? `${v}d` : '') },
      { key: 'note', label: 'Note', width: 54, format: (v) => truncate(v, 54) },
    ]),
    '',
    '  Close one out with: compliance-item done <scheme> "<item>" [--evidence=BWoF-2026] [--due=]',
  ];
  return { text: lines.join('\n'), json: rows };
}

async function cmdComplianceItem(db, args, flags) {
  const [verb, schemeRef, ...kindParts] = args;
  if (verb !== 'done' && verb !== 'fail' && verb !== 'exempt') {
    throw new CliError('compliance-item done|fail|exempt <scheme> "<item>" [--on=] [--due=] [--evidence=] [--note=]');
  }
  const s = await resolve(db, 'scheme', schemeRef);
  const kind = kindParts.join(' ').trim();
  if (!kind) throw new CliError('Which item? Run `compliance-items --scheme=<code> --all` to see them.');
  const matches = await db.query('select * from compliance_items where scheme_id = $1 and kind ilike $2', [s.id, `%${kind}%`]);
  if (!matches.length) throw new CliError(`No compliance item on ${s.code} matches "${kind}".`);
  if (matches.length > 1) {
    throw new CliError(`"${kind}" matches ${matches.length} items on ${s.code}:\n` + matches.map((m) => `  ${m.kind} (${m.status})`).join('\n'));
  }
  const on = parseDate(flags.on) || today();
  const status = verb === 'done' ? 'compliant' : verb === 'exempt' ? 'exempt' : 'not compliant';
  const [row] = await db.query(
    `update compliance_items set status = $2, assessed_on = $3, done_on = $4,
            due_on = coalesce($5, due_on),
            evidence_ref = coalesce(nullif($6, ''), evidence_ref), note = coalesce(nullif($7, ''), note)
     where id = $1 returning *`,
    [matches[0].id, status, on, verb === 'done' ? on : null, parseDate(flags.due), str(flags.evidence), str(flags.note)],
  );
  // Two items mirror columns on the scheme that the rule check reads directly.
  if (verb === 'done' && row.kind === 'building warrant of fitness') {
    await db.query('update schemes set bwof_expires_on = $2 where id = $1', [s.id, parseDate(flags.due) || addDays(on, 365)]);
  }
  if (verb === 'done' && row.kind === 'long-term maintenance plan review') {
    await db.query('update schemes set ltmp_reviewed_on = $2 where id = $1', [s.id, on]);
  }
  return { text: `${s.code} ${row.kind} is now "${status}" as at ${on}${row.evidence_ref ? ` (${row.evidence_ref})` : ''}.`, json: row };
}

// The rules in docs/compliance.md, run against the data.
const COMPLIANCE_RULES = [
  {
    key: 'agm-deadline',
    title: 'Hold the AGM within six months of the end of the financial year',
    source: 'Unit Titles Act 2010, s 89',
    sql: `select p.scheme_code as record, p.scheme as subject, (-p.days_to_deadline) as days,
                 'The deadline was ' || to_char(p.agm_deadline, 'DD Mon YYYY') || ' and no AGM has been held or booked' as detail
          from v_agm_position p
          where p.days_to_deadline < 0 and not p.agm_held_this_year and not p.agm_booked
          order by days desc`,
  },
  {
    key: 'meeting-notice',
    title: 'Fourteen days written notice of a general meeting',
    source: 'Unit Titles Act 2010 and the Unit Titles Regulations 2011 (notice of general meetings)',
    sql: `select p.scheme_code as record, p.scheme as subject, coalesce(p.notice_days, 0) as days,
                 p.next_meeting_kind || ' booked for ' || to_char(p.next_meeting_on, 'DD Mon') ||
                 case when p.notice_sent_on is null then ' with no notice recorded'
                      else ' with ' || p.notice_days || ' days notice' end as detail
          from v_agm_position p
          where p.next_meeting_on is not null
            and p.next_meeting_kind in ('AGM', 'EGM')
            and (p.notice_sent_on is null or p.notice_days < 14)
          order by p.next_meeting_on`,
  },
  {
    key: 'ltmp-review',
    title: 'A long-term maintenance plan covering at least ten years, kept current',
    source: 'Unit Titles Act 2010, ss 115 and 116; the 2022 Amendment Act extends new plans to thirty years for larger schemes',
    sql: `select s.code as record, s.name as subject,
                 coalesce(current_date - s.ltmp_reviewed_on, 9999) as days,
                 case when s.ltmp_reviewed_on is null then 'No LTMP review on record at all'
                      when s.ltmp_years < 10 then 'The plan covers ' || s.ltmp_years || ' years; the Act requires at least ten'
                      else 'Last reviewed ' || to_char(s.ltmp_reviewed_on, 'DD Mon YYYY') || ', ' ||
                           round((current_date - s.ltmp_reviewed_on) / 365.0, 1) || ' years ago' end as detail
          from schemes s
          where s.status = 'managed'
            and (s.ltmp_reviewed_on is null or s.ltmp_reviewed_on < current_date - 1095 or coalesce(s.ltmp_years, 0) < 10)
          order by days desc`,
  },
  {
    key: 'insurance-cover',
    title: 'Principal insurance in force at all times',
    source: 'Unit Titles Act 2010, s 135',
    sql: `select s.code as record, s.name as subject,
                 coalesce(current_date - ip.expires_on, 9999) as days,
                 case when ip.id is null then 'No principal policy on file at all'
                      else 'The principal policy expired ' || to_char(ip.expires_on, 'DD Mon YYYY') end as detail
          from schemes s
          left join insurance_policies ip
            on ip.id = (select p2.id from insurance_policies p2 where p2.scheme_id = s.id and p2.kind = 'principal'
                        order by p2.expires_on desc limit 1)
          where s.status = 'managed' and (ip.id is null or ip.expires_on < current_date)
          order by days desc`,
  },
  {
    key: 'insurance-valuation',
    title: 'A current replacement valuation behind the sum insured',
    source: 'Unit Titles Act 2010, s 135 requires full replacement value; three years is this business\'s own line',
    sql: `select i.scheme_code as record, i.scheme as subject, coalesce(i.valuation_age_days, 9999) as days,
                 case when i.valuation_on is null then 'No valuation recorded behind the ' || to_char(i.sum_insured_cents / 100.0, 'FM$999,999,990') || ' sum insured'
                      else 'Valuation dated ' || to_char(i.valuation_on, 'DD Mon YYYY') || ', ' ||
                           round(i.valuation_age_days / 365.0, 1) || ' years old' end as detail
          from v_insurance_position i
          where i.kind = 'principal' and (i.valuation_on is null or i.valuation_age_days > 1095)
          order by days desc`,
  },
  {
    key: 'levy-arrears-ladder',
    title: 'Chase arrears up the ladder: reminder at thirty days, formal demand at sixty, recovery at ninety',
    source: 'The ladder is the business\'s own. Levies are recoverable as a debt under the Unit Titles Act 2010; interest is capped at ten percent a year (Unit Titles Regulations 2011)',
    sql: `select a.lot_ref as record, a.scheme as subject, a.days_behind as days,
                 case when a.days_behind >= 90 and a.recovery_started_on is null
                        then a.days_behind || ' days behind and recovery has never been started'
                      when a.days_behind >= 60 and a.last_demand_on is null
                        then a.days_behind || ' days behind and no formal demand on file'
                      else a.days_behind || ' days behind and not even a reminder has gone out' end as detail
          from v_arrears a
          where (a.days_behind >= 90 and a.recovery_started_on is null)
             or (a.days_behind >= 60 and a.last_demand_on is null)
             or (a.days_behind >= 30 and a.last_reminder_on is null)
          order by a.days_behind desc`,
  },
  {
    key: 'disclosure-clock',
    title: 'Provide a pre-settlement disclosure statement within five working days',
    source: 'Unit Titles Act 2010, s 147; pre-contract disclosure before the buyer signs is s 146',
    sql: `select coalesce(d.lot_ref, d.scheme_code) as record, d.scheme as subject, d.working_days_open as days,
                 d.kind || ' requested ' || to_char(d.requested_on, 'DD Mon YYYY') || ' by ' || d.requested_by ||
                 ' and still not provided after ' || d.working_days_open || ' working days' as detail
          from v_disclosures_open d
          where d.kind = 'pre-settlement' and d.working_days_open > 5
          order by days desc`,
  },
  {
    key: 'financial-statements',
    title: 'Financial statements prepared each year, and audited unless the body corporate opts out',
    source: 'Unit Titles Act 2010, s 132',
    sql: `select ci.scheme_code as record, ci.scheme as subject, coalesce(ci.days_overdue, 0) as days,
                 'Financial statements are "' || ci.status || '": ' || coalesce(nullif(ci.note, ''), 'no note on file') as detail
          from v_compliance_due ci
          where ci.kind = 'financial statements and audit'
            and ci.status not in ('compliant', 'exempt')
          order by days desc`,
  },
  {
    key: 'spend-approval',
    title: 'Work over the committee\'s delegated limit is not committed without an approval on file',
    source: 'The committee\'s delegated authority, set by the body corporate. The Act lets a body corporate delegate to its committee with limits (Unit Titles Act 2010)',
    sql: `select coalesce(j.job_no, mr.job_ref) as record, s.name as subject,
                 (current_date - j.issued_on) as days,
                 'Job issued ' || to_char(j.issued_on, 'DD Mon YYYY') || ' for "' || mr.summary || '" with committee approval still outstanding' as detail
          from contractor_jobs j
          join maintenance_requests mr on mr.id = j.maintenance_id
          join schemes s on s.id = mr.scheme_id
          where mr.committee_approval_required
            and mr.committee_approved_on is null
            and j.issued_on is not null
            and j.status <> 'cancelled'
          order by days desc`,
  },
  {
    key: 'bwof',
    title: 'A current building warrant of fitness wherever a compliance schedule is in force',
    source: 'Building Act 2004, s 108: the BWoF is renewed every twelve months',
    sql: `select s.code as record, s.name as subject,
                 coalesce(current_date - s.bwof_expires_on, 9999) as days,
                 case when s.bwof_expires_on is null then 'A compliance schedule is in force and no BWoF is on file'
                      else 'The BWoF expired ' || to_char(s.bwof_expires_on, 'DD Mon YYYY') end as detail
          from schemes s
          where s.status = 'managed' and s.has_compliance_schedule
            and (s.bwof_expires_on is null or s.bwof_expires_on < current_date)
          order by days desc`,
  },
  {
    key: 'minutes',
    title: 'Minutes of every meeting kept, and sent to owners within a month',
    source: 'The Unit Titles Regulations 2011 require minutes to be kept; the one month promise is this business\'s own service standard',
    sql: `select s.code as record, s.name as subject, (current_date - mt.held_on) as days,
                 mt.kind || ' held ' || to_char(mt.held_on, 'DD Mon YYYY') || ' and the minutes have never gone to owners' as detail
          from meetings mt
          join schemes s on s.id = mt.scheme_id
          where mt.held_on is not null and mt.minutes_sent_on is null and mt.held_on < current_date - 30
          order by days desc`,
  },
];

async function cmdCompliance(db, args, flags) {
  const only = args[0];
  const results = [];
  for (const rule of COMPLIANCE_RULES) {
    if (only && rule.key !== only) continue;
    const rows = await db.query(rule.sql);
    results.push({ ...rule, breaches: rows.length, rows });
  }
  if (!results.length) throw new CliError(`No rule called "${only}". Rules: ${COMPLIANCE_RULES.map((r) => r.key).join(', ')}`);
  const [counts] = await db.query(
    `select (select count(*) from schemes where status = 'managed') as schemes,
            (select count(*) from lots where status = 'active') as lots`,
  );
  const lines = [heading('Compliance check')];
  lines.push(
    table(
      results.map((r) => ({
        rule: r.title,
        breaches: r.breaches,
        worst: r.rows[0] ? `${r.rows[0].record} (${r.rows[0].days}d)` : '',
        source: r.source,
      })),
      [
        { key: 'rule', label: 'Rule', width: 64 },
        { key: 'breaches', label: 'Breaches', align: 'right' },
        { key: 'worst', label: 'Worst', width: 20 },
        { key: 'source', label: 'Source', width: 72 },
      ],
    ),
  );
  for (const r of results.filter((x) => x.breaches)) {
    lines.push(`\n  ${r.title}  (${r.source})`);
    for (const row of r.rows.slice(0, 12)) {
      lines.push(`    ${String(row.record).padEnd(10)} ${String(row.subject || '').slice(0, 28).padEnd(29)} ${row.detail}`);
    }
    if (r.rows.length > 12) lines.push(`    ... and ${r.rows.length - 12} more`);
  }
  lines.push(
    `\n  Records: ${counts.schemes} schemes under management, ${counts.lots} lots.` +
      '\n  The body corporate\'s bank account and its trust ledger are not in this system. They stay where they are.' +
      '\n  Nothing here is legal advice. The rules are the ones docs/compliance.md records, with their sources.',
  );
  return { text: lines.join('\n'), json: results.map(({ key, title, source, breaches, rows }) => ({ key, title, source, breaches, rows })) };
}

// ---------------------------------------------------------------------------
// The week

const ATTENTION_ORDER = [
  'arrears_recovery', 'arrears_demand', 'arrears_reminder', 'arrears_watch',
  'insurance_expired', 'agm_overdue', 'meeting_short_notice', 'maintenance_habitability',
  'disclosure_overdue', 'insurance_expiring', 'valuation_stale', 'maintenance_committee_waiting',
  'maintenance_no_contractor', 'compliance_overdue', 'agm_deadline_close', 'minutes_not_sent',
  'job_not_invoiced', 'agreement_expiring', 'task_overdue', 'scheme_quiet',
];

const ATTENTION_LABEL = {
  arrears_recovery: 'Arrears past ninety days, recovery never started',
  arrears_demand: 'Arrears past sixty days, no formal demand',
  arrears_reminder: 'Arrears past thirty days, not even a reminder',
  arrears_watch: 'Behind, but inside the reminder window',
  insurance_expired: 'Principal insurance EXPIRED',
  agm_overdue: 'AGM past the statutory deadline',
  meeting_short_notice: 'General meeting booked without proper notice',
  maintenance_habitability: 'Habitability work still open',
  disclosure_overdue: 'Disclosure past the five working days',
  insurance_expiring: 'Insurance expiring inside thirty days',
  valuation_stale: 'Sum insured resting on a stale valuation',
  maintenance_committee_waiting: 'Maintenance waiting on a committee',
  maintenance_no_contractor: 'Approved and nobody sent',
  compliance_overdue: 'Compliance items not met',
  agm_deadline_close: 'AGM deadline inside sixty days, nothing booked',
  minutes_not_sent: 'Minutes never sent to owners',
  job_not_invoiced: 'Contractor work with no invoice',
  agreement_expiring: 'Management agreement expiring',
  task_overdue: 'Tasks overdue',
  scheme_quiet: 'Schemes nobody has spoken to',
};

async function cmdAttention(db, args, flags) {
  const where = [];
  const params = [];
  if (flags.manager && flags.manager !== true) {
    const m = await resolve(db, 'manager', flags.manager);
    params.push(m.full_name);
    where.push(`manager = $${params.length}`);
  }
  const rows = await db.query(`select * from v_attention_due ${where.length ? 'where ' + where.join(' and ') : ''}`, params);
  rows.sort((a, b) => {
    const d = ATTENTION_ORDER.indexOf(a.reason) - ATTENTION_ORDER.indexOf(b.reason);
    return d !== 0 ? d : num(b.days) - num(a.days);
  });
  const lines = [heading(`Needs a decision this week (${rows.length})`)];
  for (const reason of ATTENTION_ORDER) {
    const group = rows.filter((r) => r.reason === reason);
    if (!group.length) continue;
    lines.push(`\n  ${ATTENTION_LABEL[reason] || reason} (${group.length})`);
    lines.push(
      table(group, [
        { key: 'label', label: 'Record', width: 12 },
        { key: 'scheme', label: 'Scheme', width: 26 },
        { key: 'party', label: 'Who', width: 26 },
        { key: 'days', label: 'Days', align: 'right' },
        { key: 'amount_cents', label: 'Value', align: 'right', format: (v) => (num(v) ? money(v) : '') },
        { key: 'manager', label: 'Manager', width: 13 },
        { key: 'detail', label: 'Detail', width: 66, format: (v) => truncate(v, 66) },
      ]),
    );
  }
  return { text: lines.join('\n'), json: rows };
}

async function cmdStats(db) {
  const [s] = await db.query(`
    select (select count(*) from schemes where status = 'managed')                                            as schemes,
           (select count(*) from lots where status = 'active')                                                as lots,
           (select count(*) from owners where status = 'active')                                              as owners,
           (select coalesce(sum(base_fee_annual_cents), 0) from schemes where status = 'managed')             as base_fees_cents,
           (select count(*) from v_arrears)                                                                   as lots_in_arrears,
           (select coalesce(sum(arrears_cents), 0) from v_arrears)                                            as arrears_cents,
           (select count(*) from v_arrears where days_behind >= 60)                                           as arrears_serious,
           (select count(*) from v_agm_position where days_to_deadline < 0 and not agm_held_this_year and not agm_booked) as agms_overdue,
           (select count(*) from meetings where held_on is null and scheduled_on >= current_date)             as meetings_booked,
           (select count(*) from v_insurance_position where days_to_expiry < 0)                               as policies_expired,
           (select count(*) from v_insurance_position where days_to_expiry between 0 and 60)                  as policies_expiring,
           (select count(*) from v_maintenance_open)                                                          as maintenance_open,
           (select count(*) from v_maintenance_open where days_waiting_on_committee >= 7)                     as maintenance_committee,
           (select count(*) from v_disclosures_open)                                                          as disclosures_open,
           (select count(*) from v_disclosures_open where working_days_open > 5)                              as disclosures_late,
           (select count(*) from compliance_items where status not in ('compliant', 'exempt'))                as compliance_gaps,
           (select count(*) from tasks where status = 'open' and due_on < current_date)                       as tasks_overdue,
           (select count(*) from v_attention_due)                                                             as attention
  `);
  const [levied] = await db.query(
    `select coalesce(sum(total_cents), 0) as struck from levy_runs where due_on >= current_date - 365`,
  );
  const text = [
    heading('The portfolio'),
    `  ${s.schemes} schemes under management, ${s.lots} lots, ${s.owners} owners`,
    `  ${money(s.base_fees_cents)} a year in base management fees`,
    `  ${money(levied.struck)} of levies struck across the last twelve months`,
    heading('Levies'),
    `  ${s.lots_in_arrears} lots behind, ${money(s.arrears_cents)} owing, ${s.arrears_serious} past sixty days`,
    heading('The calendar'),
    `  ${s.agms_overdue} AGMs past the statutory deadline, ${s.meetings_booked} meetings booked`,
    `  ${s.disclosures_open} disclosure requests open, ${s.disclosures_late} past the five working days`,
    heading('The buildings'),
    `  ${s.maintenance_open} maintenance requests open, ${s.maintenance_committee} waiting on a committee`,
    `  ${s.policies_expired} insurance policies EXPIRED, ${s.policies_expiring} expiring inside sixty days`,
    `  ${s.compliance_gaps} compliance items not met`,
    heading('Housekeeping'),
    `  ${s.tasks_overdue} tasks overdue`,
    `  ${s.attention} items on the attention list`,
  ].join('\n');
  return { text, json: s };
}

// ---------------------------------------------------------------------------
// Tasks and the contact log

async function cmdTasks(db, args, flags) {
  const rows = await db.query(
    `select t.*, coalesce(s.code, '') as scheme_code, coalesce(s.name, '') as scheme,
            coalesce(m.full_name, 'unassigned') as manager
     from tasks t
     left join schemes s on s.id = t.scheme_id
     left join managers m on m.id = t.manager_id
     ${flags.all ? '' : "where t.status = 'open'"}
     order by t.status, t.due_on nulls last`,
  );
  const overdue = rows.filter((r) => r.status === 'open' && r.due_on && isoDate(r.due_on) < today()).length;
  const text =
    heading(`Tasks (${rows.length}${overdue ? `, ${overdue} overdue` : ''})`) +
    '\n' +
    table(rows, [
      { key: 'id', label: 'Id', format: (v) => short(v) },
      { key: 'due_on', label: 'Due', format: (v) => isoDate(v) },
      { key: 'kind', label: 'Kind', width: 12 },
      { key: 'title', label: 'What', width: 54, format: (v) => truncate(v, 54) },
      { key: 'scheme', label: 'Scheme', width: 24 },
      { key: 'manager', label: 'Who', width: 13 },
      { key: 'status', label: 'Status', width: 8 },
    ]);
  return { text, json: rows };
}

async function cmdTask(db, args, flags) {
  const [verb, ...rest] = args;
  if (verb === 'done') {
    const t = await resolve(db, 'task', rest.join(' '));
    const [row] = await db.query("update tasks set status = 'done', done_on = $2 where id = $1 returning *", [t.id, parseDate(flags.on) || today()]);
    return { text: `Done: ${row.title}`, json: row };
  }
  if (verb !== 'add') throw new CliError('task add "<what>" [--due=YYYY-MM-DD --scheme= --lot= --owner= --kind=]');
  const title = rest.join(' ');
  if (!title) throw new CliError('What is the task?');
  const manager = await whoIs(db, flags);
  const s = flags.scheme && flags.scheme !== true ? await resolve(db, 'scheme', flags.scheme) : null;
  const l = flags.lot && flags.lot !== true ? await resolve(db, 'lot', flags.lot) : null;
  const o = flags.owner && flags.owner !== true ? await resolve(db, 'owner', flags.owner) : null;
  const [row] = await db.query(
    `insert into tasks (title, kind, due_on, scheme_id, lot_id, owner_id, manager_id, note)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
    [title, str(flags.kind) || 'task', parseDate(flags.due) || addDays(today(), 7), s?.id ?? l?.scheme_id ?? null, l?.id ?? null, o?.id ?? null, manager?.id ?? null, str(flags.note)],
  );
  return { text: `Task added, due ${isoDate(row.due_on)}: ${title}`, json: row };
}

async function cmdNote(db, args, flags) {
  const [subject, ...bodyParts] = args;
  const body = bodyParts.join(' ');
  if (!subject || !body) throw new CliError('note "<scheme, lot or owner>" "<what was said and what was agreed>" [--kind=call|email|letter|visit] [--on=]');
  const scheme = await resolve(db, 'scheme', subject, { optional: true });
  const lot = scheme ? null : await resolve(db, 'lot', subject, { optional: true });
  const owner = scheme || lot ? null : await resolve(db, 'owner', subject, { optional: true });
  if (!scheme && !lot && !owner) throw new CliError(`"${subject}" is not a scheme, a lot or an owner I can find.`);
  const manager = await whoIs(db, flags);
  const [row] = await db.query(
    `insert into contact_notes (happened_on, kind, who, body, scheme_id, lot_id, owner_id, manager_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
    [
      parseDate(flags.on) || today(),
      str(flags.kind) || 'note',
      str(flags.who) || null,
      body,
      scheme?.id ?? lot?.scheme_id ?? null,
      lot?.id ?? null,
      owner?.id ?? null,
      manager?.id ?? null,
    ],
  );
  const label = scheme ? scheme.name : lot ? `${lot.ref} ${lot.scheme_name}` : owner.name;
  return { text: `Logged against ${label} on ${isoDate(row.happened_on)}: ${truncate(body, 90)}`, json: row };
}

// ---------------------------------------------------------------------------
// add

async function cmdAdd(db, args, flags) {
  const [what, ...rest] = args;
  const name = rest.join(' ');
  if (what === 'scheme') {
    if (!name) throw new CliError('add scheme "<name>" --code=ABC [--plan= --address= --suburb= --fy-end=YYYY-MM-DD --spend-limit=1500 --fee=]');
    const code = str(flags.code).toUpperCase();
    if (!code) throw new CliError('Give the scheme a short code: --code=ABC. It becomes the lot prefix (ABC-01).');
    const manager = await whoIs(db, flags);
    const [row] = await db.query(
      `insert into schemes (code, name, plan_number, address_line, suburb, city, scheme_type, manager_id, managed_since,
                            last_fy_end_on, committee_spend_limit_cents, base_fee_annual_cents,
                            has_compliance_schedule, has_lift, has_pool)
       values ($1, $2, $3, $4, $5, $6, $7, $8, current_date, $9, $10, $11, $12, $13, $14) returning *`,
      [
        code, name, str(flags.plan), str(flags.address), str(flags.suburb), str(flags.city) || null,
        str(flags.type) || 'residential', manager?.id ?? null, parseDate(flags['fy-end']),
        parseMoney(flags['spend-limit']), parseMoney(flags.fee),
        Boolean(flags['compliance-schedule']), Boolean(flags.lift), Boolean(flags.pool),
      ],
    );
    await createComplianceItems(db, row.id);
    return {
      text:
        `Scheme added: ${row.code} ${row.name}.\n` +
        `  Seven compliance items created, all "unknown". Assess them: compliance-items --scheme=${row.code} --all\n` +
        `  Add the lots: add lot ${row.code} --lot=1 --unit="Apt 1" --interest=1 --owner="<name>"`,
      json: row,
    };
  }
  if (what === 'lot') {
    const s = await resolve(db, 'scheme', flags.scheme || name);
    const lotNo = Number(flags.lot);
    if (!lotNo) throw new CliError('add lot <scheme> --lot=7 [--unit="Apt 7" --interest=1 --type=residential --owner="<name>"]');
    const ref = str(flags.ref) || `${s.code}-${String(lotNo).padStart(2, '0')}`;
    const [row] = await db.query(
      `insert into lots (ref, scheme_id, lot_number, unit_label, lot_type, bedrooms, utility_interest)
       values ($1, $2, $3, $4, $5, $6, $7) returning *`,
      [ref, s.id, lotNo, str(flags.unit) || `Lot ${lotNo}`, str(flags.type) || 'residential', Number(flags.beds) || null, Number(flags.interest) || 1.0],
    );
    let ownerLine = '';
    if (flags.owner && flags.owner !== true) {
      let o = await resolve(db, 'owner', flags.owner, { optional: true });
      if (!o) {
        [o] = await db.query('insert into owners (name, email, phone) values ($1, $2, $3) returning *', [str(flags.owner), str(flags.email), str(flags.phone)]);
        ownerLine = `\n  Owner created: ${o.name}.`;
      }
      await db.query('insert into lot_owners (lot_id, owner_id, is_primary, since_on) values ($1, $2, true, $3) on conflict do nothing', [row.id, o.id, today()]);
      ownerLine += `\n  ${o.name} linked as the owner.`;
    }
    return { text: `Lot added: ${row.ref} (${row.unit_label}) at ${s.name}, utility interest ${row.utility_interest}.${ownerLine}`, json: row };
  }
  if (what === 'owner') {
    if (!name) throw new CliError('add owner "<name>" [--email= --phone= --type=individual|couple|trust|company]');
    const [row] = await db.query(
      'insert into owners (name, owner_type, email, phone, postal_address, city) values ($1, $2, $3, $4, $5, $6) returning *',
      [name, str(flags.type) || 'individual', str(flags.email), str(flags.phone), str(flags.address), str(flags.city)],
    );
    return { text: `Owner added: ${row.name}`, json: row };
  }
  if (what === 'contractor') {
    if (!name) throw new CliError('add contractor "<name>" --trade=roofing [--phone= --email= --licence=]');
    const [row] = await db.query(
      `insert into contractors (name, trade, contact_name, email, phone, licence_ref, licence_type, insurance_expires_on, preferred)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
      [name, str(flags.trade) || 'general', str(flags.contact), str(flags.email), str(flags.phone), str(flags.licence), str(flags['licence-type']), parseDate(flags['insurance-expires']), Boolean(flags.preferred)],
    );
    return { text: `Contractor added: ${row.name} (${row.trade})`, json: row };
  }
  if (what === 'policy') {
    const s = await resolve(db, 'scheme', flags.scheme || name);
    const [row] = await db.query(
      `insert into insurance_policies (scheme_id, kind, insurer, broker, policy_number, sum_insured_cents, premium_cents,
                                       valuation_cents, valuation_on, started_on, expires_on)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *`,
      [
        s.id, str(flags.kind) || 'principal', str(flags.insurer), str(flags.broker), str(flags.number),
        parseMoney(flags.sum), parseMoney(flags.premium), parseMoney(flags.valuation),
        parseDate(flags['valuation-on']), parseDate(flags.started) || today(), parseDate(flags.expires),
      ],
    );
    return { text: `${row.kind} policy added for ${s.name}${row.insurer ? ` with ${row.insurer}` : ''}${row.expires_on ? `, expires ${isoDate(row.expires_on)}` : ''}.`, json: row };
  }
  throw new CliError('add scheme|lot|owner|contractor|policy <...>');
}

// ---------------------------------------------------------------------------
// Import

const FORMATS = {
  stratamax: {
    label: 'StrataMax',
    schemes: {
      code: ['Building Number', 'Body Corporate Number', 'Code'],
      name: ['Building Name', 'Body Corporate Name', 'Name'],
      plan: ['Plan Number', 'CTS Number', 'Plan'],
      address: ['Address', 'Building Address', 'Street Address'],
      suburb: ['Suburb', 'City'],
    },
    lots: {
      scheme: ['Building Name', 'Body Corporate Name', 'Plan Number', 'Building'],
      lot: ['Lot Number', 'Lot'],
      unit: ['Unit Number', 'Unit'],
      interest: ['Contribution Entitlement', 'Unit Entitlement', 'Entitlement', 'Interest'],
      owner: ['Owner Name', 'Name on Title', 'Owner'],
      email: ['Email', 'Owner Email', 'Email Address'],
      phone: ['Phone', 'Mobile', 'Contact Number'],
      address: ['Postal Address', 'Mailing Address', 'Address for Service'],
    },
  },
  propertyiq: {
    label: 'PropertyIQ',
    schemes: {
      code: ['BC Number', 'Body Corporate Number', 'Code'],
      name: ['Body Corporate', 'Body Corporate Name', 'Name'],
      plan: ['Unit Plan', 'Plan Number', 'DP Number'],
      address: ['Address', 'Property Address'],
      suburb: ['Suburb', 'City'],
    },
    lots: {
      scheme: ['Body Corporate', 'Body Corporate Name', 'BC Number'],
      lot: ['Unit', 'Lot Number', 'Lot'],
      unit: ['Unit', 'Unit Number'],
      interest: ['Utility Interest', 'Ownership Interest', 'Interest', 'UI'],
      owner: ['Owner', 'Owner Name', 'Owners'],
      email: ['Email', 'Owner Email'],
      phone: ['Phone', 'Mobile'],
      address: ['Postal Address', 'Address for Service'],
    },
  },
};
FORMATS['strata-master'] = { ...FORMATS.stratamax, label: 'Strata Master' };
FORMATS.csv = {
  label: 'a plain CSV',
  schemes: mergeMaps('schemes'),
  lots: mergeMaps('lots'),
};

function mergeMaps(section) {
  const out = {};
  for (const f of [FORMATS.stratamax, FORMATS.propertyiq]) {
    for (const [k, names] of Object.entries(f[section])) out[k] = [...new Set([...(out[k] || []), ...names])];
  }
  return out;
}

function readCsvFile(file, what) {
  if (!file || file === true) return null;
  const p = path.resolve(String(file));
  if (!existsSync(p)) throw new CliError(`No ${what} file at ${p}`);
  return parseCsv(readFileSync(p, 'utf8'));
}

function codeFromName(name) {
  const words = String(name).replace(/[^a-zA-Z0-9 ]/g, '').split(/\s+/).filter(Boolean);
  const code = words.length >= 2 ? words.map((w) => w[0]).join('').slice(0, 4) : String(words[0] || 'SCH').slice(0, 4);
  return code.toUpperCase();
}

async function cmdImport(db, args, flags) {
  const format = (args[0] || 'csv').toLowerCase();
  const spec = FORMATS[format];
  if (!spec) throw new CliError(`Unknown format "${format}". Use: ${Object.keys(FORMATS).join(', ')}`);
  const schemes = readCsvFile(flags.schemes, 'schemes');
  const lots = readCsvFile(flags.lots, 'lots');
  if (!schemes && !lots) {
    throw new CliError(
      `import ${format} --schemes=schemes.csv --lots=lots.csv [--dry-run]\n` +
        `  Export the building list and the roll from ${spec.label} and point at the files. Run --dry-run first.`,
    );
  }
  const dry = Boolean(flags['dry-run']);
  const counts = { schemes: 0, schemes_updated: 0, lots: 0, lots_updated: 0, owners: 0, skipped: [] };
  const get = (row, map, key) => pick(row, ...(map[key] || []));
  // On a dry run nothing is written, so a lot cannot find the scheme the same
  // run "would have" created. This set keeps the dry run honest.
  const pendingSchemes = new Set();
  const remember = (...keys) => keys.filter(Boolean).forEach((k) => pendingSchemes.add(String(k).toLowerCase()));

  if (schemes) {
    for (const row of schemes) {
      const name = get(row, spec.schemes, 'name');
      if (!name) { counts.skipped.push('scheme with no name'); continue; }
      const [existing] = await db.query('select id from schemes where lower(name) = lower($1)', [name]);
      if (existing) { counts.schemes_updated++; continue; }
      counts.schemes++;
      remember(name, get(row, spec.schemes, 'plan'), get(row, spec.schemes, 'code'));
      if (dry) continue;
      let code = (get(row, spec.schemes, 'code') || codeFromName(name)).toUpperCase().slice(0, 6);
      // Codes have to be unique; suffix a digit if an import collides.
      for (let i = 2; ; i++) {
        const [clash] = await db.query('select 1 from schemes where code = $1', [code]);
        if (!clash) break;
        code = `${code.replace(/\d+$/, '')}${i}`;
      }
      const [created] = await db.query(
        `insert into schemes (code, name, plan_number, address_line, suburb, external_ref, managed_since)
         values ($1, $2, nullif($3, ''), nullif($4, ''), nullif($5, ''), nullif($6, ''), current_date) returning id`,
        [code, name, get(row, spec.schemes, 'plan'), get(row, spec.schemes, 'address'), get(row, spec.schemes, 'suburb'), get(row, spec.schemes, 'code')],
      );
      await createComplianceItems(db, created.id);
    }
  }

  if (lots) {
    for (const row of lots) {
      const schemeKey = get(row, spec.lots, 'scheme');
      const [scheme] = schemeKey
        ? await db.query(
            'select id, code from schemes where lower(name) = lower($1) or lower(coalesce(plan_number, \'\')) = lower($1) or lower(coalesce(external_ref, \'\')) = lower($1) or lower(code) = lower($1)',
            [schemeKey],
          )
        : [null];
      const schemePending = !scheme && schemeKey && pendingSchemes.has(String(schemeKey).toLowerCase());
      if (!scheme && !schemePending) { counts.skipped.push(`lot for "${schemeKey}": scheme not found`); continue; }
      const lotNo = Number(String(get(row, spec.lots, 'lot')).replace(/[^0-9]/g, ''));
      if (!lotNo) { counts.skipped.push(`lot in "${schemeKey}" with no lot number`); continue; }
      if (scheme) {
        const [existing] = await db.query('select id from lots where scheme_id = $1 and lot_number = $2', [scheme.id, lotNo]);
        if (existing) { counts.lots_updated++; continue; }
      }
      counts.lots++;
      if (dry) continue;
      const ref = `${scheme.code}-${String(lotNo).padStart(2, '0')}`;
      const interest = Number(String(get(row, spec.lots, 'interest')).replace(/[^0-9.]/g, '')) || 1.0;
      const [created] = await db.query(
        `insert into lots (ref, scheme_id, lot_number, unit_label, utility_interest, external_ref)
         values ($1, $2, $3, nullif($4, ''), $5, nullif($6, '')) returning id`,
        [ref, scheme.id, lotNo, get(row, spec.lots, 'unit'), interest, `${schemeKey}:${lotNo}`],
      );
      const ownerName = get(row, spec.lots, 'owner');
      if (ownerName) {
        const [existingOwner] = await db.query('select id from owners where lower(name) = lower($1)', [ownerName]);
        let ownerId = existingOwner?.id;
        if (!ownerId) {
          counts.owners++;
          const [madeOwner] = await db.query(
            'insert into owners (name, email, phone, postal_address) values ($1, nullif($2, \'\'), nullif($3, \'\'), nullif($4, \'\')) returning id',
            [ownerName, get(row, spec.lots, 'email'), get(row, spec.lots, 'phone'), get(row, spec.lots, 'address')],
          );
          ownerId = madeOwner.id;
        }
        await db.query('insert into lot_owners (lot_id, owner_id, is_primary, since_on) values ($1, $2, true, current_date) on conflict do nothing', [created.id, ownerId]);
      }
    }
  }

  const lines = [
    heading(`${dry ? 'Dry run: what an' : 'An'} import from ${spec.label} ${dry ? 'would do' : 'did'}`),
    `  Schemes  ${counts.schemes} new, ${counts.schemes_updated} already here`,
    `  Lots     ${counts.lots} new, ${counts.lots_updated} already here`,
    `  Owners   ${counts.owners} new`,
  ];
  if (counts.skipped.length) {
    lines.push(`  Skipped  ${counts.skipped.length}`);
    for (const s of counts.skipped.slice(0, 15)) lines.push(`    ${s}`);
    if (counts.skipped.length > 15) lines.push(`    ... and ${counts.skipped.length - 15} more`);
  }
  lines.push(
    '',
    '  What does not come across: the levy ledger and the bank account (they stay in the old system until the',
    '  changeover date), meeting minutes as documents, and insurance policy files. Read docs/replace-stratamax.md.',
    '  Every scheme imported gets its seven compliance items as "unknown". Assess them before you rely on /compliance.',
    '  Then set each scheme\'s FY end, spend limit and insurance: the levy and AGM machinery needs them.',
  );
  return { text: lines.join('\n'), json: counts };
}

// ---------------------------------------------------------------------------
// Export

const EXPORT_TABLES = [
  'managers', 'schemes', 'lots', 'owners', 'lot_owners', 'committee_members', 'levy_runs', 'levy_charges',
  'levy_payments', 'arrears_events', 'meetings', 'motions', 'maintenance_requests', 'contractors',
  'contractor_jobs', 'insurance_policies', 'disclosure_requests', 'compliance_items', 'tasks', 'contact_notes',
];

async function cmdExport(db, args, flags) {
  const out = {};
  const counts = {};
  for (const t of EXPORT_TABLES) {
    const rows = await db.query(`select * from ${t}`);
    out[t] = rows;
    counts[t] = rows.length;
  }
  const file = str(flags.out) || path.join(REPO_ROOT, 'exports', `strata-${today()}.json`);
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  writeFileSync(path.resolve(file), JSON.stringify(out, null, 2));
  return {
    text:
      `Exported ${Object.values(counts).reduce((a, b) => a + b, 0)} rows across ${EXPORT_TABLES.length} tables to ${file}\n` +
      Object.entries(counts).map(([k, v]) => `  ${String(v).padStart(6)}  ${k}`).join('\n') +
      '\n  No bank account, no trust ledger, no receipts into a bank. There is nothing of that kind in this database to export.',
    json: { file, counts },
  };
}

// ---------------------------------------------------------------------------
// Help and dispatch

const HELP = `body-corporate-for-claude-code: a body corporate management business as a database and a CLI.

  npm run strata -- <command> [args] [--flags] [--json]

The week
  arrears [--min-days=] [--scheme=]         who is behind, how far, and the next rung of the ladder
  arrears-log <lot> "<action>"              noted | reminder | formal demand | payment plan | debt recovery | resolved
  meetings-due                              every scheme against the s 89 AGM deadline, with the notice position
  maintenance [--urgent] [--all]            everything open, worst first, and which committee it is waiting on
  disclosures                               open disclosure requests against the five working day clock
  insurance [--expired]                     the whole programme: expiry, valuation age, premium
  attention [--manager=]                    everything that wants a decision this week
  weekly-review                             see .claude/commands/weekly-review.md

The portfolio
  schemes [q] [--manager=]                  every body corporate, its AGM position and its gaps
  scheme <code|name>                        one scheme in full
  lots [--scheme=] / lot <ref>              the roll, and one lot's whole levy position
  owners [q] / owner <name>                 the owners, their lots and their committee seats
  committee [scheme] / committee add|remove the committees
  contractors [--all]                       the trades, their licences and what they have been paid

Levies
  levies [--scheme=] [--all]                every run: struck, due, and what is still outstanding
  levy strike <scheme> --total= --due=      strike a run, split across the lots by utility interest
  levy paid <lot> --amount=                 record a receipt. A record, not a bank transaction

Meetings
  meeting schedule <scheme> --kind= --on=   book it, with the s 89 deadline checked
  meeting notice <id> [--on=]               record the notice, with the fourteen day check
  meeting held <id> [--quorum]              record it happened
  meeting minutes <id> [--on=]              record the minutes went to owners
  motion add <meeting> "<title>"            build the agenda
  motion result <meeting> <n> carried|lost  record the vote

Property work
  maintenance new <scheme> "<what>"         raise it
  maintenance ask|approve|decline|complete  move it through the committee
  job issue <maintenance> "<contractor>"    send someone (refused until the committee approves)
  job book|done|invoice|cancel <job>        move the job

Compliance and sales
  compliance [<rule>]                       the Act and the regulations, run against your records
  compliance-items [--scheme=] [--all]      the register: LTMP, valuation, BWoF, audit, fire, asbestos, pool
  compliance-item done|fail|exempt          close one out
  insurance renew <policy> --expires=       record a renewal
  insurance valuation <scheme> --amount=    record a new replacement valuation
  disclosure request <lot> / provide <lot>  the statutory clock on a sale

Housekeeping
  tasks [--all] / task add|done             the list
  note "<scheme|lot|owner>" "<what>"        the contact log
  add scheme|lot|owner|contractor|policy
  import stratamax|propertyiq|strata-master|csv --schemes= --lots= [--dry-run]
  export [--out=file.json]                  the whole database
  stats                                     the portfolio in numbers

Money in dollars: --total=16800 means $16,800.00. Any command takes --json. Ids shorten to their first 8 characters.
Names, codes and refs match case-insensitively; an ambiguous one lists the candidates rather than guessing.
No client money lives here. The body corporate's bank account stays in the system that already holds it.
`;

const COMMANDS = {
  schemes: cmdSchemes,
  scheme: cmdScheme,
  lots: cmdLots,
  lot: cmdLot,
  owners: cmdOwners,
  owner: cmdOwner,
  committee: cmdCommittee,
  arrears: cmdArrears,
  'arrears-log': cmdArrearsLog,
  levies: cmdLevies,
  levy: cmdLevy,
  meetings: cmdMeetings,
  'meetings-due': cmdMeetingsDue,
  meeting: cmdMeeting,
  motion: cmdMotion,
  maintenance: cmdMaintenance,
  jobs: cmdJobs,
  job: cmdJob,
  contractors: cmdContractors,
  insurance: cmdInsurance,
  disclosures: cmdDisclosures,
  disclosure: cmdDisclosure,
  compliance: cmdCompliance,
  'compliance-items': cmdComplianceItems,
  'compliance-item': cmdComplianceItem,
  attention: cmdAttention,
  tasks: cmdTasks,
  task: cmdTask,
  note: cmdNote,
  add: cmdAdd,
  import: cmdImport,
  export: cmdExport,
  stats: cmdStats,
};

async function main() {
  const { args, flags } = parseArgv(process.argv.slice(2));
  const [command, ...rest] = args;
  if (!command || command === 'help' || flags.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const fn = COMMANDS[command];
  if (!fn) {
    process.stderr.write(`Unknown command "${command}".\n\n${HELP}`);
    return 1;
  }
  const db = await getDb();
  try {
    const result = await fn(db, rest, flags);
    if (flags.json) process.stdout.write(JSON.stringify(result.json, null, 2) + '\n');
    else process.stdout.write(result.text.replace(/^\n/, '') + '\n');
    return 0;
  } catch (e) {
    if (e instanceof CliError) {
      process.stderr.write(`${e.message}\n`);
      return e.code;
    }
    if (/relation "?\w+"? does not exist/.test(e.message)) {
      process.stderr.write('The database has no tables yet. Run: npm run migrate\n');
      return 1;
    }
    throw e;
  } finally {
    await db.close();
  }
}

process.exitCode = await main();
