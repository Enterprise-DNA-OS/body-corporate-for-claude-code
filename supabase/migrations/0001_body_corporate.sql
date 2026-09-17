-- body-corporate-for-claude-code: core schema.
-- A body corporate and strata management business: the schemes under management,
-- the lots and their owners, the committee, levy runs and the levy ledger,
-- arrears and the steps that follow them, general meetings and their motions,
-- maintenance on common property and the contractor jobs under it, the insurance
-- programme, disclosure requests with their statutory clock, the compliance
-- register every scheme carries, tasks and the contact log.
--
-- Runs unchanged on PGlite (embedded) and on Postgres / Supabase.
--
-- Money is stored in cents and it is a RECORD, not a bank balance. Body corporate
-- funds stay in the bank account and the trust ledger that hold them today: this
-- database never receipts a levy into a bank, never pays a contractor and never
-- reconciles an account. It records what was struck, what came in, what is owed
-- and what the manager must report. That boundary is deliberate and it is written
-- into every command.

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end
$$;

-- Working days, because the Unit Titles Act counts in them: a pre-settlement
-- disclosure statement has five working days (s 147), and levies are chased on
-- a ladder measured in days.
create or replace function working_days_between(d1 date, d2 date) returns integer
language plpgsql immutable as $$
declare n integer := 0; i integer;
begin
  if d1 is null or d2 is null or d2 <= d1 then return 0; end if;
  for i in 0 .. (d2 - d1) - 1 loop
    if extract(isodow from (d1 + i)) < 6 then n := n + 1; end if;
  end loop;
  return n;
end
$$;

-- People --------------------------------------------------------------------
-- The strata managers at the management company. One manager runs a portfolio
-- of schemes; the principal signs off; accounts runs the levy ledger.

create table if not exists managers (
  id            uuid primary key default gen_random_uuid(),
  full_name     text not null,
  code          text,
  email         text,
  phone         text,
  role          text not null default 'body corporate manager',
  active        boolean not null default true,
  started_on    date,
  external_ref  text unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists managers_name_lower_idx on managers (lower(full_name));

-- Schemes ---------------------------------------------------------------------
-- One scheme is one body corporate: a unit plan, its lots, its funds, its
-- committee and its rules. committee_spend_limit_cents is the committee's
-- delegated authority; anything over it needs a resolution before a contractor
-- is engaged. last_fy_end_on drives the AGM deadline (UTA 2010 s 89: within six
-- months of the end of the financial year).

create table if not exists schemes (
  id                            uuid primary key default gen_random_uuid(),
  code                          text not null unique,
  name                          text not null,
  plan_number                   text,
  address_line                  text,
  suburb                        text,
  city                          text,
  country                       text not null default 'NZ',
  scheme_type                   text not null default 'residential',
  year_built                    integer,
  status                        text not null default 'managed',
  manager_id                    uuid references managers(id) on delete set null,
  managed_since                 date,
  agreement_expires_on          date,
  base_fee_annual_cents         bigint not null default 0,
  last_fy_end_on                date,
  committee_spend_limit_cents   bigint not null default 0,
  ltmp_years                    integer,
  ltmp_reviewed_on              date,
  ltmp_fund_opted_out           boolean not null default false,
  audit_opted_out               boolean not null default false,
  has_compliance_schedule       boolean not null default false,
  bwof_expires_on               date,
  has_lift                      boolean not null default false,
  has_pool                      boolean not null default false,
  external_ref                  text unique,
  notes                         text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);
create unique index if not exists schemes_name_lower_idx on schemes (lower(name));
create index if not exists schemes_manager_idx on schemes (manager_id);

-- Lots ------------------------------------------------------------------------
-- One lot is one unit on the plan. utility_interest is the share the levies are
-- split by (the ownership or utility interest on the plan). ref is the short
-- handle a manager types: HV-07.

create table if not exists lots (
  id                 uuid primary key default gen_random_uuid(),
  ref                text not null unique,
  scheme_id          uuid not null references schemes(id) on delete cascade,
  lot_number         integer not null,
  unit_label         text,
  lot_type           text not null default 'residential',
  bedrooms           integer,
  utility_interest   numeric(10,4) not null default 1.0,
  status             text not null default 'active',
  external_ref       text unique,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists lots_scheme_idx on lots (scheme_id, lot_number);

-- Owners ------------------------------------------------------------------------

create table if not exists owners (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  owner_type      text not null default 'individual',
  email           text,
  phone           text,
  postal_address  text,
  city            text,
  status          text not null default 'active',
  external_ref    text unique,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists owners_name_lower_idx on owners (lower(name));

create table if not exists lot_owners (
  id          uuid primary key default gen_random_uuid(),
  lot_id      uuid not null references lots(id) on delete cascade,
  owner_id    uuid not null references owners(id) on delete cascade,
  is_primary  boolean not null default false,
  since_on    date,
  until_on    date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists lot_owners_pair_idx on lot_owners (lot_id, owner_id);

-- The committee -------------------------------------------------------------------

create table if not exists committee_members (
  id          uuid primary key default gen_random_uuid(),
  scheme_id   uuid not null references schemes(id) on delete cascade,
  owner_id    uuid not null references owners(id) on delete cascade,
  role        text not null default 'committee member',
  since_on    date,
  until_on    date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists committee_pair_idx on committee_members (scheme_id, owner_id);

-- Levies ----------------------------------------------------------------------
-- A levy run is one resolution: a total struck against a fund, split across the
-- lots by utility interest. The charges and the payments against them are a
-- RECORD so the arrears maths works. The money itself lands in the body
-- corporate's own bank account, in the system that holds it.

create table if not exists levy_runs (
  id            uuid primary key default gen_random_uuid(),
  scheme_id     uuid not null references schemes(id) on delete cascade,
  fund          text not null default 'operating',
  name          text not null,
  struck_on     date,
  due_on        date not null,
  total_cents   bigint not null default 0,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists levy_runs_scheme_idx on levy_runs (scheme_id, due_on desc);

create table if not exists levy_charges (
  id            uuid primary key default gen_random_uuid(),
  levy_run_id   uuid not null references levy_runs(id) on delete cascade,
  lot_id        uuid not null references lots(id) on delete cascade,
  amount_cents  bigint not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists levy_charges_pair_idx on levy_charges (levy_run_id, lot_id);
create index if not exists levy_charges_lot_idx on levy_charges (lot_id);

create table if not exists levy_payments (
  id            uuid primary key default gen_random_uuid(),
  lot_id        uuid not null references lots(id) on delete cascade,
  paid_on       date not null,
  amount_cents  bigint not null default 0,
  method        text,
  reference     text,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists levy_payments_lot_idx on levy_payments (lot_id, paid_on desc);

-- Arrears ----------------------------------------------------------------------
-- Every step of the arrears ladder, dated, so the file stands up when it reaches
-- a debt collector or the Tenancy Tribunal's unit titles jurisdiction: reminder,
-- formal demand, payment plan, recovery, resolved.

create table if not exists arrears_events (
  id            uuid primary key default gen_random_uuid(),
  lot_id        uuid not null references lots(id) on delete cascade,
  noted_on      date not null,
  action        text not null default 'noted',
  days_behind   integer,
  amount_cents  bigint not null default 0,
  manager_id    uuid references managers(id) on delete set null,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists arrears_events_lot_idx on arrears_events (lot_id, noted_on desc);

-- Meetings and motions -----------------------------------------------------------
-- The AGM is the deadline the Act sets (s 89). notice_sent_on against
-- scheduled_on is the notice period; minutes_sent_on is the promise to owners
-- that quietly gets missed.

create table if not exists meetings (
  id               uuid primary key default gen_random_uuid(),
  scheme_id        uuid not null references schemes(id) on delete cascade,
  kind             text not null default 'AGM',
  scheduled_on     date,
  notice_sent_on   date,
  held_on          date,
  minutes_sent_on  date,
  quorum_met       boolean,
  venue            text,
  manager_id       uuid references managers(id) on delete set null,
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists meetings_scheme_idx on meetings (scheme_id, scheduled_on desc);

create table if not exists motions (
  id             uuid primary key default gen_random_uuid(),
  meeting_id     uuid not null references meetings(id) on delete cascade,
  number         integer not null default 1,
  title          text not null,
  detail         text,
  kind           text not null default 'ordinary',
  result         text not null default 'pending',
  votes_for      integer,
  votes_against  integer,
  abstained      integer,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists motions_meeting_idx on motions (meeting_id, number);

-- Maintenance ----------------------------------------------------------------------
-- Work on common property, and the committee approval gate. habitability marks
-- the ones that are not a nice to have: water coming into a unit, the lift out,
-- the fire system down.

create table if not exists maintenance_requests (
  id                            uuid primary key default gen_random_uuid(),
  job_ref                       text unique,
  scheme_id                     uuid not null references schemes(id) on delete cascade,
  lot_id                        uuid references lots(id) on delete set null,
  reported_on                   date not null,
  reported_by                   text not null default 'owner',
  category                      text not null default 'general',
  priority                      text not null default 'normal',
  summary                       text not null,
  detail                        text,
  status                        text not null default 'new',
  habitability                  boolean not null default false,
  committee_approval_required   boolean not null default true,
  committee_asked_on            date,
  committee_approved_on         date,
  approval_ref                  text,
  approval_limit_cents          bigint not null default 0,
  completed_on                  date,
  closed_on                     date,
  manager_id                    uuid references managers(id) on delete set null,
  note                          text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);
create index if not exists maintenance_scheme_idx on maintenance_requests (scheme_id, reported_on desc);
create index if not exists maintenance_status_idx on maintenance_requests (status);

create table if not exists contractors (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  trade                 text not null default 'general',
  contact_name          text,
  email                 text,
  phone                 text,
  licence_ref           text,
  licence_type          text,
  insurance_expires_on  date,
  preferred             boolean not null default false,
  active                boolean not null default true,
  external_ref          text unique,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index if not exists contractors_name_lower_idx on contractors (lower(name));

create table if not exists contractor_jobs (
  id              uuid primary key default gen_random_uuid(),
  job_no          text unique,
  maintenance_id  uuid not null references maintenance_requests(id) on delete cascade,
  contractor_id   uuid references contractors(id) on delete set null,
  issued_on       date,
  scheduled_on    date,
  completed_on    date,
  quoted_cents    bigint not null default 0,
  invoiced_cents  bigint not null default 0,
  invoiced_on     date,
  invoice_ref     text,
  status          text not null default 'issued',
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists contractor_jobs_maintenance_idx on contractor_jobs (maintenance_id);

-- Insurance -----------------------------------------------------------------------
-- The programme the Act requires: principal insurance to full replacement value
-- (UTA 2010 s 135), with the valuation it rests on. One row per policy.

create table if not exists insurance_policies (
  id                 uuid primary key default gen_random_uuid(),
  scheme_id          uuid not null references schemes(id) on delete cascade,
  kind               text not null default 'principal',
  insurer            text,
  broker             text,
  policy_number      text,
  sum_insured_cents  bigint not null default 0,
  premium_cents      bigint not null default 0,
  excess_note        text,
  valuation_cents    bigint not null default 0,
  valuation_on       date,
  started_on         date,
  expires_on         date,
  note               text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists insurance_scheme_idx on insurance_policies (scheme_id, expires_on desc);

-- Disclosures -----------------------------------------------------------------------
-- A sale in the scheme starts a statutory clock: the pre-settlement disclosure
-- statement has five working days from the request (UTA 2010 s 147). This table
-- is that clock.

create table if not exists disclosure_requests (
  id            uuid primary key default gen_random_uuid(),
  scheme_id     uuid not null references schemes(id) on delete cascade,
  lot_id        uuid references lots(id) on delete set null,
  kind          text not null default 'pre-settlement',
  requested_on  date not null,
  requested_by  text,
  provided_on   date,
  manager_id    uuid references managers(id) on delete set null,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists disclosures_scheme_idx on disclosure_requests (scheme_id, requested_on desc);

-- Compliance items ----------------------------------------------------------------
-- One row per obligation per scheme: the AGM, the LTMP review, the insurance
-- valuation, the building warrant of fitness, the audit, the fire evacuation
-- scheme, the asbestos register. Plus anything the business tracks on top.

create table if not exists compliance_items (
  id            uuid primary key default gen_random_uuid(),
  scheme_id     uuid not null references schemes(id) on delete cascade,
  kind          text not null,
  standard      text,
  status        text not null default 'unknown',
  assessed_on   date,
  due_on        date,
  done_on       date,
  evidence_ref  text,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists compliance_items_scheme_kind_idx on compliance_items (scheme_id, kind);

-- Tasks and the contact log ---------------------------------------------------------

create table if not exists tasks (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  kind            text not null default 'task',
  due_on          date,
  status          text not null default 'open',
  done_on         date,
  scheme_id       uuid references schemes(id) on delete cascade,
  lot_id          uuid references lots(id) on delete cascade,
  owner_id        uuid references owners(id) on delete cascade,
  maintenance_id  uuid references maintenance_requests(id) on delete cascade,
  manager_id      uuid references managers(id) on delete set null,
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists tasks_status_idx on tasks (status, due_on);

create table if not exists contact_notes (
  id           uuid primary key default gen_random_uuid(),
  happened_on  date not null,
  kind         text not null default 'note',
  who          text,
  body         text not null,
  scheme_id    uuid references schemes(id) on delete cascade,
  lot_id       uuid references lots(id) on delete cascade,
  owner_id     uuid references owners(id) on delete cascade,
  manager_id   uuid references managers(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists contact_notes_scheme_idx on contact_notes (scheme_id, happened_on desc);
create index if not exists contact_notes_owner_idx on contact_notes (owner_id, happened_on desc);

-- updated_at triggers -------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'managers', 'schemes', 'lots', 'owners', 'lot_owners', 'committee_members',
    'levy_runs', 'levy_charges', 'levy_payments', 'arrears_events', 'meetings',
    'motions', 'maintenance_requests', 'contractors', 'contractor_jobs',
    'insurance_policies', 'disclosure_requests', 'compliance_items', 'tasks',
    'contact_notes'
  ] loop
    execute format('drop trigger if exists set_updated_at_%1$s on %1$s', t);
    execute format('create trigger set_updated_at_%1$s before update on %1$s for each row execute function set_updated_at()', t);
  end loop;
end
$$;

-- Views ---------------------------------------------------------------------

-- One row per lot with everything the levy side needs: who owns it, what has
-- been charged and fallen due, what has been paid, and what is owed.
create or replace view v_lot_position as
select
  l.id                                   as lot_id,
  l.ref                                  as lot_ref,
  l.lot_number,
  coalesce(l.unit_label, 'Lot ' || l.lot_number) as unit,
  l.lot_type,
  l.utility_interest,
  s.id                                   as scheme_id,
  s.code                                 as scheme_code,
  s.name                                 as scheme,
  coalesce(m.full_name, 'unassigned')    as manager,
  coalesce((select string_agg(o.name, ', ' order by lo.is_primary desc, o.name)
            from lot_owners lo join owners o on o.id = lo.owner_id
            where lo.lot_id = l.id and lo.until_on is null), 'no owner on file') as owners,
  (select o.email from lot_owners lo join owners o on o.id = lo.owner_id
   where lo.lot_id = l.id and lo.until_on is null order by lo.is_primary desc, o.name limit 1) as owner_email,
  coalesce((select sum(c.amount_cents) from levy_charges c join levy_runs r on r.id = c.levy_run_id
            where c.lot_id = l.id and r.due_on <= current_date), 0) as charged_due_cents,
  coalesce((select sum(c.amount_cents) from levy_charges c where c.lot_id = l.id), 0) as charged_all_cents,
  coalesce((select sum(p.amount_cents) from levy_payments p where p.lot_id = l.id), 0) as paid_cents,
  (select max(p.paid_on) from levy_payments p where p.lot_id = l.id) as last_payment_on,
  (select min(r.due_on)
   from levy_runs r join levy_charges c on c.levy_run_id = r.id
   where c.lot_id = l.id and r.due_on <= current_date
     and (select coalesce(sum(c2.amount_cents), 0)
          from levy_charges c2 join levy_runs r2 on r2.id = c2.levy_run_id
          where c2.lot_id = l.id and r2.due_on <= r.due_on)
         > coalesce((select sum(p.amount_cents) from levy_payments p where p.lot_id = l.id), 0)) as arrears_since
from lots l
join schemes s on s.id = l.scheme_id
left join managers m on m.id = s.manager_id
where l.status = 'active';

-- Arrears, the number a body corporate manager is judged on. The ladder is the
-- business's own: reminder at 30 days, formal demand at 60, recovery at 90.
-- Interest, if charged, is capped at 10 percent a year (UT Regulations 2011).
create or replace view v_arrears as
select
  p.lot_id,
  p.lot_ref,
  p.unit,
  p.scheme_id,
  p.scheme_code,
  p.scheme,
  p.owners,
  p.owner_email,
  p.manager,
  (p.charged_due_cents - p.paid_cents)                     as arrears_cents,
  p.arrears_since,
  case when p.arrears_since is null then 0
       else current_date - p.arrears_since end             as days_behind,
  p.last_payment_on,
  (select max(a.noted_on) from arrears_events a where a.lot_id = p.lot_id and a.action = 'reminder')       as last_reminder_on,
  (select max(a.noted_on) from arrears_events a where a.lot_id = p.lot_id and a.action = 'formal demand')  as last_demand_on,
  (select max(a.noted_on) from arrears_events a where a.lot_id = p.lot_id and a.action = 'debt recovery')  as recovery_started_on,
  (select max(a.noted_on) from arrears_events a where a.lot_id = p.lot_id and a.action = 'payment plan')   as payment_plan_on
from v_lot_position p
where (p.charged_due_cents - p.paid_cents) > 0;

-- The AGM position per scheme: the deadline the Act sets, what has been held,
-- what is booked and whether the notice actually went out in time.
create or replace view v_agm_position as
select
  s.id                                  as scheme_id,
  s.code                                as scheme_code,
  s.name                                as scheme,
  coalesce(m.full_name, 'unassigned')   as manager,
  s.last_fy_end_on,
  (s.last_fy_end_on + interval '6 months')::date as agm_deadline,
  ((s.last_fy_end_on + interval '6 months')::date - current_date) as days_to_deadline,
  (select max(mt.held_on) from meetings mt where mt.scheme_id = s.id and mt.kind = 'AGM') as last_agm_on,
  nm.id                                 as next_meeting_id,
  nm.kind                               as next_meeting_kind,
  nm.scheduled_on                       as next_meeting_on,
  nm.notice_sent_on,
  case when nm.scheduled_on is null or nm.notice_sent_on is null then null
       else (nm.scheduled_on - nm.notice_sent_on) end as notice_days,
  exists (select 1 from meetings mt where mt.scheme_id = s.id and mt.kind = 'AGM'
          and mt.held_on is not null and mt.held_on > s.last_fy_end_on) as agm_held_this_year,
  exists (select 1 from meetings mt where mt.scheme_id = s.id and mt.kind = 'AGM'
          and mt.held_on is null and mt.scheduled_on is not null and mt.scheduled_on >= current_date) as agm_booked
from schemes s
left join managers m on m.id = s.manager_id
left join meetings nm
  on nm.id = (select m2.id from meetings m2
              where m2.scheme_id = s.id and m2.held_on is null and m2.scheduled_on is not null
                and m2.scheduled_on >= current_date
              order by m2.scheduled_on limit 1)
where s.status = 'managed';

-- Every maintenance request that is not finished, with who it is waiting on.
create or replace view v_maintenance_open as
select
  mr.id                                  as maintenance_id,
  coalesce(mr.job_ref, '')               as job_ref,
  s.id                                   as scheme_id,
  s.code                                 as scheme_code,
  s.name                                 as scheme,
  coalesce(l.ref, 'common property')     as lot_ref,
  coalesce(m.full_name, 'unassigned')    as manager,
  mr.reported_on,
  (current_date - mr.reported_on)        as days_open,
  mr.reported_by,
  mr.category,
  mr.priority,
  mr.habitability,
  mr.summary,
  mr.status,
  mr.committee_approval_required,
  mr.committee_asked_on,
  mr.committee_approved_on,
  s.committee_spend_limit_cents,
  case when mr.committee_asked_on is not null and mr.committee_approved_on is null
       then (current_date - mr.committee_asked_on) else null end as days_waiting_on_committee,
  j.id                                   as job_id,
  coalesce(j.job_no, '')                 as job_no,
  coalesce(ct.name, '')                  as contractor,
  j.scheduled_on                         as job_scheduled_on,
  j.completed_on                         as job_completed_on,
  coalesce(j.quoted_cents, 0)            as quoted_cents,
  coalesce(j.invoiced_cents, 0)          as invoiced_cents,
  coalesce(j.status, 'no contractor')    as job_status
from maintenance_requests mr
join schemes s on s.id = mr.scheme_id
left join lots l on l.id = mr.lot_id
left join managers m on m.id = mr.manager_id
left join contractor_jobs j on j.id = (select j2.id from contractor_jobs j2 where j2.maintenance_id = mr.id order by j2.issued_on desc nulls last limit 1)
left join contractors ct on ct.id = j.contractor_id
where mr.status not in ('completed', 'declined');

-- The insurance programme with the two numbers that matter: days to expiry, and
-- how old the valuation the sum insured rests on is.
create or replace view v_insurance_position as
select
  ip.id                                  as policy_id,
  s.id                                   as scheme_id,
  s.code                                 as scheme_code,
  s.name                                 as scheme,
  coalesce(m.full_name, 'unassigned')    as manager,
  ip.kind,
  coalesce(ip.insurer, '')               as insurer,
  coalesce(ip.policy_number, '')         as policy_number,
  ip.sum_insured_cents,
  ip.premium_cents,
  ip.valuation_cents,
  ip.valuation_on,
  case when ip.valuation_on is null then null else (current_date - ip.valuation_on) end as valuation_age_days,
  ip.expires_on,
  case when ip.expires_on is null then null else (ip.expires_on - current_date) end as days_to_expiry
from insurance_policies ip
join schemes s on s.id = ip.scheme_id
left join managers m on m.id = s.manager_id;

-- Disclosure requests with the statutory clock on them.
create or replace view v_disclosures_open as
select
  d.id                                   as disclosure_id,
  s.code                                 as scheme_code,
  s.name                                 as scheme,
  coalesce(l.ref, '')                    as lot_ref,
  coalesce(p.owners, '')                 as owners,
  coalesce(m.full_name, 'unassigned')    as manager,
  d.kind,
  d.requested_on,
  coalesce(d.requested_by, '')           as requested_by,
  working_days_between(d.requested_on, current_date) as working_days_open,
  d.provided_on,
  coalesce(d.note, '')                   as note
from disclosure_requests d
join schemes s on s.id = d.scheme_id
left join lots l on l.id = d.lot_id
left join v_lot_position p on p.lot_id = d.lot_id
left join managers m on m.id = d.manager_id
where d.provided_on is null;

-- Every compliance item that is not compliant, or falls due inside sixty days.
create or replace view v_compliance_due as
select
  ci.id                                as item_id,
  s.id                                 as scheme_id,
  s.code                               as scheme_code,
  s.name                               as scheme,
  coalesce(m.full_name, 'unassigned')  as manager,
  ci.kind,
  coalesce(ci.standard, '')            as standard,
  ci.status,
  ci.assessed_on,
  ci.due_on,
  ci.done_on,
  coalesce(ci.evidence_ref, '')        as evidence_ref,
  case when ci.due_on is null then null else (current_date - ci.due_on) end as days_overdue,
  coalesce(ci.note, '')                as note
from compliance_items ci
join schemes s on s.id = ci.scheme_id
left join managers m on m.id = s.manager_id
where ci.status <> 'compliant'
   or ci.due_on is null
   or ci.due_on <= current_date + 60;

-- One row per scheme: the whole position a manager holds in their head.
create or replace view v_scheme_summary as
select
  s.id                                  as scheme_id,
  s.code                                as scheme_code,
  s.name                                as scheme,
  coalesce(s.suburb, '')                as suburb,
  s.scheme_type,
  s.status,
  coalesce(m.full_name, 'unassigned')   as manager,
  s.base_fee_annual_cents,
  s.agreement_expires_on,
  (select count(*) from lots l where l.scheme_id = s.id and l.status = 'active') as lots,
  coalesce((select sum(p.charged_due_cents - p.paid_cents) from v_lot_position p
            where p.scheme_id = s.id and p.charged_due_cents > p.paid_cents), 0) as arrears_cents,
  (select count(*) from v_arrears a where a.scheme_id = s.id) as lots_in_arrears,
  a.agm_deadline,
  a.days_to_deadline,
  a.last_agm_on,
  a.agm_held_this_year,
  a.agm_booked,
  (select min(ip.expires_on) from insurance_policies ip where ip.scheme_id = s.id and ip.kind = 'principal') as insurance_expires_on,
  (select max(ip.valuation_on) from insurance_policies ip where ip.scheme_id = s.id and ip.kind = 'principal') as valuation_on,
  (select count(*) from v_maintenance_open v where v.scheme_id = s.id) as open_maintenance,
  (select count(*) from compliance_items ci where ci.scheme_id = s.id and ci.status not in ('compliant', 'exempt')) as compliance_gaps,
  (select count(*) from v_disclosures_open d where d.scheme_code = s.code) as open_disclosures,
  (select o.name from committee_members cm join owners o on o.id = cm.owner_id
   where cm.scheme_id = s.id and cm.role = 'chairperson' and cm.until_on is null limit 1) as chairperson,
  (select max(n.happened_on) from contact_notes n where n.scheme_id = s.id) as last_contact_on,
  (select current_date - max(n.happened_on) from contact_notes n where n.scheme_id = s.id) as days_since_contact
from schemes s
left join managers m on m.id = s.manager_id
left join v_agm_position a on a.scheme_id = s.id;

-- Everything that wants a decision this week, worst first.
create or replace view v_attention_due as
select 'arrears_recovery' as reason,
       a.lot_ref as label,
       a.scheme,
       a.owners as party,
       a.manager,
       a.days_behind as days,
       a.arrears_cents as amount_cents,
       'Ninety days behind and recovery has never been started. The ladder is reminder, formal demand, recovery.' as detail
from v_arrears a
where a.days_behind >= 90 and a.recovery_started_on is null

union all
select 'arrears_demand',
       a.lot_ref, a.scheme, a.owners, a.manager, a.days_behind, a.arrears_cents,
       'Sixty days behind and no formal demand on file'
from v_arrears a
where a.days_behind >= 60 and a.days_behind < 90 and a.last_demand_on is null

union all
select 'arrears_reminder',
       a.lot_ref, a.scheme, a.owners, a.manager, a.days_behind, a.arrears_cents,
       'Thirty days behind and not even a reminder has gone out'
from v_arrears a
where a.days_behind >= 30 and a.days_behind < 60 and a.last_reminder_on is null

union all
select 'arrears_watch',
       a.lot_ref, a.scheme, a.owners, a.manager, a.days_behind, a.arrears_cents,
       'Behind but inside the reminder window. A phone call, not a letter.'
from v_arrears a
where a.days_behind < 30

union all
select 'agm_overdue',
       p.scheme_code, p.scheme, coalesce(to_char(p.last_agm_on, 'DD Mon YYYY'), 'no AGM on file'), p.manager,
       (-p.days_to_deadline), 0::bigint,
       'The AGM deadline was ' || to_char(p.agm_deadline, 'DD Mon YYYY') || ' (six months after FY end, UTA 2010 s 89) and no AGM has been held or booked'
from v_agm_position p
where p.days_to_deadline < 0 and not p.agm_held_this_year and not p.agm_booked

union all
select 'agm_deadline_close',
       p.scheme_code, p.scheme, coalesce(to_char(p.last_agm_on, 'DD Mon YYYY'), 'no AGM on file'), p.manager,
       p.days_to_deadline, 0::bigint,
       'The AGM deadline is ' || to_char(p.agm_deadline, 'DD Mon YYYY') || ' and nothing is booked. Notice needs fourteen days on top of finding a date.'
from v_agm_position p
where p.days_to_deadline >= 0 and p.days_to_deadline <= 60 and not p.agm_held_this_year and not p.agm_booked

union all
select 'meeting_short_notice',
       p.scheme_code, p.scheme, p.next_meeting_kind, p.manager, coalesce(p.notice_days, 0), 0::bigint,
       p.next_meeting_kind || ' booked for ' || to_char(p.next_meeting_on, 'DD Mon') ||
       case when p.notice_sent_on is null then ' and no notice has been sent'
            else ' with only ' || p.notice_days || ' days notice. Written notice of a general meeting needs fourteen days.' end
from v_agm_position p
where p.next_meeting_on is not null
  and p.next_meeting_kind in ('AGM', 'EGM')
  and (p.notice_sent_on is null or p.notice_days < 14)

union all
select 'minutes_not_sent',
       s.code, s.name, mt.kind, coalesce(m.full_name, 'unassigned'),
       (current_date - mt.held_on), 0::bigint,
       mt.kind || ' held ' || to_char(mt.held_on, 'DD Mon') || ' and the minutes have never gone to owners'
from meetings mt
join schemes s on s.id = mt.scheme_id
left join managers m on m.id = mt.manager_id
where mt.held_on is not null
  and mt.minutes_sent_on is null
  and mt.held_on < current_date - 14

union all
select 'insurance_expired',
       i.scheme_code, i.scheme, i.insurer, i.manager, (-i.days_to_expiry), i.sum_insured_cents,
       'The ' || i.kind || ' policy EXPIRED ' || to_char(i.expires_on, 'DD Mon YYYY') || '. The Act requires principal insurance at all times (UTA 2010 s 135).'
from v_insurance_position i
where i.days_to_expiry < 0

union all
select 'insurance_expiring',
       i.scheme_code, i.scheme, i.insurer, i.manager, i.days_to_expiry, i.sum_insured_cents,
       'The ' || i.kind || ' policy expires ' || to_char(i.expires_on, 'DD Mon YYYY') || ' and no renewal is recorded'
from v_insurance_position i
where i.days_to_expiry >= 0 and i.days_to_expiry <= 30

union all
select 'valuation_stale',
       i.scheme_code, i.scheme, i.insurer, i.manager, i.valuation_age_days, i.valuation_cents,
       'The replacement valuation behind the sum insured is ' || round(i.valuation_age_days / 365.0, 1) || ' years old'
from v_insurance_position i
where i.kind = 'principal' and (i.valuation_on is null or i.valuation_age_days > 1095)

union all
select 'maintenance_habitability',
       coalesce(v.job_ref, v.scheme_code), v.scheme, v.lot_ref, v.manager, v.days_open, v.quoted_cents,
       'Habitability work open ' || v.days_open || ' days: ' || v.summary
from v_maintenance_open v
where v.habitability and v.job_completed_on is null

union all
select 'maintenance_committee_waiting',
       coalesce(v.job_ref, v.scheme_code), v.scheme, v.lot_ref, v.manager, v.days_waiting_on_committee, v.quoted_cents,
       'Waiting on the committee since ' || to_char(v.committee_asked_on, 'DD Mon') || ': ' || v.summary
from v_maintenance_open v
where v.days_waiting_on_committee >= 7

union all
select 'maintenance_no_contractor',
       coalesce(v.job_ref, v.scheme_code), v.scheme, v.lot_ref, v.manager, v.days_open, 0::bigint,
       'Approved ' || to_char(v.committee_approved_on, 'DD Mon') || ' and nobody has been sent to do it: ' || v.summary
from v_maintenance_open v
where v.committee_approved_on is not null and v.job_id is null

union all
select 'job_not_invoiced',
       coalesce(j.job_no, ''), s.name, coalesce(ct.name, 'unknown contractor'), coalesce(m.full_name, 'unassigned'),
       (current_date - j.completed_on), j.quoted_cents,
       'Work finished ' || to_char(j.completed_on, 'DD Mon') || ' and no invoice has come in'
from contractor_jobs j
join maintenance_requests mr on mr.id = j.maintenance_id
join schemes s on s.id = mr.scheme_id
left join contractors ct on ct.id = j.contractor_id
left join managers m on m.id = mr.manager_id
where j.completed_on is not null and j.invoiced_on is null and j.completed_on < current_date - 14

union all
select 'disclosure_overdue',
       d.lot_ref, d.scheme, d.requested_by, d.manager, d.working_days_open, 0::bigint,
       d.kind || ' disclosure requested ' || to_char(d.requested_on, 'DD Mon') || ', ' || d.working_days_open ||
       ' working days ago. A pre-settlement statement has five (UTA 2010 s 147).'
from v_disclosures_open d
where d.working_days_open > 5

union all
select 'compliance_overdue',
       c.scheme_code, c.scheme, c.kind, c.manager,
       coalesce(c.days_overdue, 0), 0::bigint,
       c.kind || ' is "' || c.status || '"' || coalesce(', due ' || to_char(c.due_on, 'DD Mon YYYY'), ', no date on file')
from v_compliance_due c
where c.status not in ('compliant', 'exempt')

union all
select 'agreement_expiring',
       s.code, s.name, 'management agreement', coalesce(m.full_name, 'unassigned'),
       (s.agreement_expires_on - current_date), s.base_fee_annual_cents,
       'The management agreement expires ' || to_char(s.agreement_expires_on, 'DD Mon YYYY') || '. Renewal is a motion at a general meeting.'
from schemes s
left join managers m on m.id = s.manager_id
where s.status = 'managed'
  and s.agreement_expires_on is not null
  and s.agreement_expires_on <= current_date + 90

union all
select 'task_overdue',
       coalesce(s.code, 'task'), coalesce(s.name, t.title), t.title, coalesce(m.full_name, 'unassigned'),
       (current_date - t.due_on), 0::bigint,
       t.title
from tasks t
left join schemes s on s.id = t.scheme_id
left join managers m on m.id = t.manager_id
where t.status = 'open' and t.due_on is not null and t.due_on < current_date

union all
select 'scheme_quiet',
       s.code, s.name, coalesce(ss.chairperson, 'no chairperson on file'), ss.manager,
       coalesce(ss.days_since_contact, 999), 0::bigint,
       'Nobody has spoken to this scheme since ' ||
       coalesce(to_char(ss.last_contact_on, 'DD Mon YYYY'), 'it came on')
from schemes s
join v_scheme_summary ss on ss.scheme_id = s.id
where s.status = 'managed'
  and (ss.last_contact_on is null or ss.last_contact_on < current_date - 90);
