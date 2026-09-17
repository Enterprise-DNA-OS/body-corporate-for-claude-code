-- Demo data for body-corporate-for-claude-code.
-- Harbour City Body Corporate Management, a fictional Wellington firm: 4 staff,
-- 6 schemes under management, 61 lots, committees, four quarters of operating
-- levies plus a maintenance fund levy per scheme, arrears at four stages of the
-- ladder, an AGM season in trouble, an insurance programme with holes in it,
-- maintenance waiting on committees and a compliance register with gaps.
--
-- Deliberately messy, so the attention list has something to say:
--   a scheme whose AGM deadline (six months after FY end, UTA 2010 s 89) passed
--     two months ago with nothing held and nothing booked
--   an AGM booked with only eight days notice instead of fourteen
--   an AGM held two months ago whose minutes have never gone to owners
--   a lot 110 days in arrears where recovery has never been started
--   a lot 64 days behind with no formal demand, one 41 days behind with not
--     even a reminder, and two inside the watch window
--   a principal insurance policy that EXPIRED twelve days ago
--   a policy expiring in 25 days with no renewal recorded
--   a sum insured resting on a replacement valuation over three years old
--   a building warrant of fitness that expired three weeks ago
--   a long-term maintenance plan not reviewed in three and a half years
--   a lift out of service and a fire alarm panel in defect
--   an $8,400 retaining wall job sitting on a committee for nineteen days
--   an approved job nobody has sent a contractor to
--   a finished job the contractor never invoiced
--   a pre-settlement disclosure request nine working days old (the Act gives five)
--   a management agreement expiring in 45 days
--   financial statements 140 days overdue and an asbestos register nobody has built
--   a chairperson nobody has spoken to in over three months
--
-- Dates are relative to current_date. Ids are derived from names with seed_uuid,
-- and every insert is ON CONFLICT DO NOTHING, so running it twice changes nothing.
--
-- No client money anywhere. The levy ledger records what was struck and what came
-- in. The body corporate's bank account stays in the system that holds it.

create or replace function seed_uuid(seed text) returns uuid language sql immutable as $$
  select (substr(m, 1, 8) || '-' || substr(m, 9, 4) || '-4' || substr(m, 13, 3)
          || '-8' || substr(m, 16, 3) || '-' || substr(m, 19, 12))::uuid
  from (select md5(seed) as m) s
$$;

-- Staff ------------------------------------------------------------------------

insert into managers (id, full_name, code, email, phone, role, active, started_on)
select seed_uuid('manager:' || v.full_name), v.full_name, v.code, v.email, v.phone, v.role, true, current_date - v.days
from (values
  ('Rachel Mataira', 'RMA', 'rachel@harbourcitybc.co.nz', '027 555 0301', 'principal',                  4100),
  ('Tom Brandon',    'TBR', 'tom@harbourcitybc.co.nz',    '027 555 0302', 'body corporate manager',     1900),
  ('Priya Sharma',   'PSH', 'priya@harbourcitybc.co.nz',  '027 555 0303', 'body corporate manager',      950),
  ('Caleb Foster',   'CFO', 'caleb@harbourcitybc.co.nz',  '027 555 0304', 'levies administrator',        600)
) as v(full_name, code, email, phone, role, days)
on conflict do nothing;

-- Schemes ------------------------------------------------------------------------

insert into schemes (id, code, name, plan_number, address_line, suburb, city, scheme_type, year_built, status,
                     manager_id, managed_since, agreement_expires_on, base_fee_annual_cents, last_fy_end_on,
                     committee_spend_limit_cents, ltmp_years, ltmp_reviewed_on, ltmp_fund_opted_out,
                     audit_opted_out, has_compliance_schedule, bwof_expires_on, has_lift, has_pool, notes)
select seed_uuid('scheme:' || v.code), v.code, v.name, v.plan, v.address, v.suburb, 'Wellington', v.stype, v.built,
       'managed', seed_uuid('manager:' || v.manager), current_date - v.since, current_date + v.agree,
       v.fee, current_date - v.fy_end, v.spend_limit, v.ltmp_years, current_date - v.ltmp_rev, false,
       v.audit_out, v.has_cs, case when v.bwof is null then null else current_date + v.bwof end,
       v.lift, v.pool, v.notes
from (values
  ('HVA', 'Harbour View Apartments',   'DP 89122',  '42 Waterloo Quay',    'Pipitea',      'residential', 1998, 'Tom Brandon',  2600, 400,  880000, 245, 200000, 10,  400, false, true,  -21,  true,  false, 'Sixteen apartments over a shared basement. The lift is original.'),
  ('MIL', 'The Millhouse',             'DP 51447',  '27 Ghuznee Street',   'Te Aro',       'residential', 1975, 'Priya Sharma', 1500, 700,  520000, 150, 150000, 10,  700, false, false, null,  false, false, 'Converted warehouse, nine units. Character building, character problems.'),
  ('CQT', 'Clyde Quay Terraces',       'DP 104220', '14 Roseneath Terrace','Roseneath',    'residential', 2006, 'Tom Brandon',  1100, 800,  410000, 130, 150000, 10,  900, true,  false, null,  false, false, 'Six townhouses stepped down the hill. Retaining walls do the real work.'),
  ('KEL', 'Kelburn Rise',              'DP 76981',  '88 Upland Road',      'Kelburn',      'residential', 1987, 'Priya Sharma', 1800, 600,  730000,  60, 200000, 10, 1290, false, false, null,  false, false, ''),
  ('VSC', 'Victoria Street Chambers',  'DP 44307',  '190 Victoria Street', 'Te Aro',       'commercial',  1968, 'Tom Brandon',  2200,  45,  690000, 330, 300000, 10,  600, false, true,   210,  false, false, 'Eight commercial suites. The 1968 build means asbestos is a live question.'),
  ('OPE', 'Oriental Parade 88',        'DP 118904', '88 Oriental Parade',  'Oriental Bay', 'residential', 2012, 'Priya Sharma',  900, 550,  940000, 170, 500000, 30,  200, false, true,   150,  true,  true,  'Ten apartments, pool, lift. North face remediation is on the horizon.')
) as v(code, name, plan, address, suburb, stype, built, manager, since, agree, fee, fy_end, spend_limit,
       ltmp_years, ltmp_rev, audit_out, has_cs, bwof, lift, pool, notes)
on conflict do nothing;

-- Lots and their owners ------------------------------------------------------------
-- One VALUES block carries both. Owners are created distinct on name, so an
-- investor who owns two lots is one owner with two lot links.

create temporary table if not exists seed_lots (
  ref text, code text, lot_number int, unit_label text, lot_type text, beds int,
  interest numeric, owner_name text, owner_type text, email text, phone text
);
delete from seed_lots;
insert into seed_lots values
  ('HVA-01', 'HVA',  1, 'Apt 1',        'residential', 2, 1.00, 'Marlborough Trustees Ltd',   'trust',      'trustees@example.com',      '04 555 0401'),
  ('HVA-02', 'HVA',  2, 'Apt 2',        'residential', 2, 1.00, 'Marlborough Trustees Ltd',   'trust',      'trustees@example.com',      '04 555 0401'),
  ('HVA-03', 'HVA',  3, 'Apt 3',        'residential', 1, 1.00, 'Deborah Lindqvist',          'individual', 'deborah.l@example.com',     '027 555 0402'),
  ('HVA-04', 'HVA',  4, 'Apt 4',        'residential', 2, 1.00, 'Sione and Mele Tupou',       'couple',     'tupou.family@example.com',  '027 555 0403'),
  ('HVA-05', 'HVA',  5, 'Apt 5',        'residential', 2, 1.00, 'Graham Southee',             'individual', 'graham.s@example.com',      '027 555 0404'),
  ('HVA-06', 'HVA',  6, 'Apt 6',        'residential', 1, 1.00, 'Annette Pryor',              'individual', 'annette.p@example.com',     '027 555 0405'),
  ('HVA-07', 'HVA',  7, 'Apt 7',        'residential', 2, 1.00, 'Warren Dukes',               'individual', 'warren.dukes@example.com',  '027 555 0406'),
  ('HVA-08', 'HVA',  8, 'Apt 8',        'residential', 2, 1.00, 'Weiland Properties Ltd',     'company',    'admin@example.com',         '04 555 0407'),
  ('HVA-09', 'HVA',  9, 'Apt 9',        'residential', 1, 1.00, 'Katrina Moses',              'individual', 'katrina.m@example.com',     '027 555 0408'),
  ('HVA-10', 'HVA', 10, 'Apt 10',       'residential', 2, 1.00, 'Duncan Blackie',             'individual', 'duncan.b@example.com',      '027 555 0409'),
  ('HVA-11', 'HVA', 11, 'Apt 11',       'residential', 2, 1.00, 'Hannah Ogilvie',             'individual', 'hannah.o@example.com',      '027 555 0410'),
  ('HVA-12', 'HVA', 12, 'Apt 12',       'residential', 2, 1.00, 'Trent Waaka',                'individual', 'trent.w@example.com',       '027 555 0411'),
  ('HVA-13', 'HVA', 13, 'Apt 13',       'residential', 1, 1.00, 'Beverley Chun',              'individual', 'beverley.c@example.com',    '027 555 0412'),
  ('HVA-14', 'HVA', 14, 'Apt 14',       'residential', 2, 1.00, 'Marcus Steinmann',           'individual', 'marcus.s@example.com',      '027 555 0413'),
  ('HVA-15', 'HVA', 15, 'Apt 15',       'residential', 2, 1.00, 'Olivia Farrant',             'individual', 'olivia.f@example.com',      '027 555 0414'),
  ('HVA-16', 'HVA', 16, 'Penthouse 16', 'residential', 3, 1.50, 'Roger Twose',                'individual', 'roger.t@example.com',       '027 555 0415'),
  ('MIL-01', 'MIL',  1, 'Unit 1',       'residential', 2, 1.00, 'Fiona Marsh',                'individual', 'fiona.marsh@example.com',   '027 555 0416'),
  ('MIL-02', 'MIL',  2, 'Unit 2',       'residential', 1, 1.00, 'Gareth Ludlow',              'individual', 'gareth.l@example.com',      '027 555 0417'),
  ('MIL-03', 'MIL',  3, 'Unit 3',       'residential', 2, 1.00, 'Petra Novakova',             'individual', 'petra.n@example.com',       '027 555 0418'),
  ('MIL-04', 'MIL',  4, 'Unit 4',       'residential', 2, 1.00, 'Hemi Walker',                'individual', 'hemi.w@example.com',        '027 555 0419'),
  ('MIL-05', 'MIL',  5, 'Unit 5',       'residential', 1, 1.00, 'Constance Bell Family Trust','trust',      'bell.trust@example.com',    '04 555 0420'),
  ('MIL-06', 'MIL',  6, 'Unit 6',       'residential', 2, 1.00, 'Ari Goldsmith',              'individual', 'ari.g@example.com',         '027 555 0421'),
  ('MIL-07', 'MIL',  7, 'Unit 7',       'residential', 2, 1.00, 'Lena Duckworth',             'individual', 'lena.d@example.com',        '027 555 0422'),
  ('MIL-08', 'MIL',  8, 'Unit 8',       'residential', 1, 1.00, 'Sefo Malielegaoi',           'individual', 'sefo.m@example.com',        '027 555 0423'),
  ('MIL-09', 'MIL',  9, 'Unit 9',       'residential', 2, 1.00, 'Tessa Broadmore',            'individual', 'tessa.b@example.com',       '027 555 0424'),
  ('CQT-01', 'CQT',  1, 'Townhouse 1',  'residential', 3, 1.00, 'Derek Hoyle',                'individual', 'derek.h@example.com',       '027 555 0425'),
  ('CQT-02', 'CQT',  2, 'Townhouse 2',  'residential', 3, 1.00, 'Ingrid Sanders',             'individual', 'ingrid.s@example.com',      '027 555 0426'),
  ('CQT-03', 'CQT',  3, 'Townhouse 3',  'residential', 3, 1.00, 'Pauline Ngata',              'individual', 'pauline.n@example.com',     '027 555 0427'),
  ('CQT-04', 'CQT',  4, 'Townhouse 4',  'residential', 4, 1.00, 'Craig and Louise Tennant',   'couple',     'tennants@example.com',      '027 555 0428'),
  ('CQT-05', 'CQT',  5, 'Townhouse 5',  'residential', 3, 1.00, 'Malcolm Frew',               'individual', 'malcolm.f@example.com',     '027 555 0429'),
  ('CQT-06', 'CQT',  6, 'Townhouse 6',  'residential', 3, 1.00, 'Susanna Bright',             'individual', 'susanna.b@example.com',     '027 555 0430'),
  ('KEL-01', 'KEL',  1, 'Flat 1',       'residential', 2, 1.00, 'Judith Kaipara',             'individual', 'judith.k@example.com',      '027 555 0431'),
  ('KEL-02', 'KEL',  2, 'Flat 2',       'residential', 1, 1.00, 'Judith Kaipara',             'individual', 'judith.k@example.com',      '027 555 0431'),
  ('KEL-03', 'KEL',  3, 'Flat 3',       'residential', 2, 1.00, 'Ross Delaney',               'individual', 'ross.d@example.com',        '027 555 0432'),
  ('KEL-04', 'KEL',  4, 'Flat 4',       'residential', 2, 1.00, 'Mikhail Ivanov',             'individual', 'mikhail.i@example.com',     '027 555 0433'),
  ('KEL-05', 'KEL',  5, 'Flat 5',       'residential', 2, 1.00, 'Prue Hastings',              'individual', 'prue.h@example.com',        '027 555 0434'),
  ('KEL-06', 'KEL',  6, 'Flat 6',       'residential', 3, 1.25, 'Baxter Property Group Ltd',  'company',    'accounts@example.com',      '04 555 0435'),
  ('KEL-07', 'KEL',  7, 'Flat 7',       'residential', 2, 1.00, 'Aroha Tamihana',             'individual', 'aroha.t@example.com',       '027 555 0436'),
  ('KEL-08', 'KEL',  8, 'Flat 8',       'residential', 1, 1.00, 'Felix Ostergaard',           'individual', 'felix.o@example.com',       '027 555 0437'),
  ('KEL-09', 'KEL',  9, 'Flat 9',       'residential', 2, 1.00, 'Colin Bracewell',            'individual', 'colin.b@example.com',       '027 555 0438'),
  ('KEL-10', 'KEL', 10, 'Flat 10',      'residential', 2, 1.00, 'Shannon McVie',              'individual', 'shannon.m@example.com',     '027 555 0439'),
  ('KEL-11', 'KEL', 11, 'Flat 11',      'residential', 1, 1.00, 'Dorothy Plummer',            'individual', 'dorothy.p@example.com',     '027 555 0440'),
  ('KEL-12', 'KEL', 12, 'Flat 12',      'residential', 2, 1.00, 'Yuki Tanaka',                'individual', 'yuki.t@example.com',        '027 555 0441'),
  ('VSC-01', 'VSC',  1, 'Suite 1',      'commercial', null, 1.60, 'Quill Holdings Ltd',       'company',    'office@example.com',        '04 555 0442'),
  ('VSC-02', 'VSC',  2, 'Suite 2',      'commercial', null, 1.40, 'Harcourt Dental Ltd',      'company',    'practice@example.com',      '04 555 0443'),
  ('VSC-03', 'VSC',  3, 'Suite 3',      'commercial', null, 1.20, 'Vantage Legal Trustees',   'trust',      'vantage@example.com',       '04 555 0444'),
  ('VSC-04', 'VSC',  4, 'Suite 4',      'commercial', null, 1.00, 'Mei Lin Chong',            'individual', 'meilin.c@example.com',      '027 555 0445'),
  ('VSC-05', 'VSC',  5, 'Suite 5',      'commercial', null, 1.00, 'Bernard Quill',            'individual', 'bernard.q@example.com',     '027 555 0446'),
  ('VSC-06', 'VSC',  6, 'Suite 6',      'commercial', null, 1.20, 'Riverstone Ventures Ltd',  'company',    'riverstone@example.com',    '04 555 0447'),
  ('VSC-07', 'VSC',  7, 'Suite 7',      'commercial', null, 0.80, 'Padma Naidoo',             'individual', 'padma.n@example.com',       '027 555 0448'),
  ('VSC-08', 'VSC',  8, 'Suite 8',      'commercial', null, 0.80, 'Torben Askew',             'individual', 'torben.a@example.com',      '027 555 0449'),
  ('OPE-01', 'OPE',  1, 'Apt 1',        'residential', 2, 1.00, 'Simone Beaumont',            'individual', 'simone.b@example.com',      '027 555 0450'),
  ('OPE-02', 'OPE',  2, 'Apt 2',        'residential', 2, 1.00, 'Harold and Faye Whitcombe',  'couple',     'whitcombes@example.com',    '027 555 0451'),
  ('OPE-03', 'OPE',  3, 'Apt 3',        'residential', 2, 1.00, 'Nga Tai Investments Ltd',    'company',    'ngatai@example.com',        '04 555 0452'),
  ('OPE-04', 'OPE',  4, 'Apt 4',        'residential', 1, 0.85, 'Rewi Paratene',              'individual', 'rewi.p@example.com',        '027 555 0453'),
  ('OPE-05', 'OPE',  5, 'Apt 5',        'residential', 2, 1.00, 'Camille Duret',              'individual', 'camille.d@example.com',     '027 555 0454'),
  ('OPE-06', 'OPE',  6, 'Apt 6',        'residential', 2, 1.00, 'Stefan Brugger',             'individual', 'stefan.b@example.com',      '027 555 0455'),
  ('OPE-07', 'OPE',  7, 'Apt 7',        'residential', 2, 1.00, 'Antonia Reyes',              'individual', 'antonia.r@example.com',     '027 555 0456'),
  ('OPE-08', 'OPE',  8, 'Apt 8',        'residential', 2, 1.00, 'Gilbert Fong',               'individual', 'gilbert.f@example.com',     '027 555 0457'),
  ('OPE-09', 'OPE',  9, 'Apt 9',        'residential', 2, 1.00, 'Maude Ellery Trust',         'trust',      'ellery.trust@example.com',  '04 555 0458'),
  ('OPE-10', 'OPE', 10, 'Penthouse 10', 'residential', 3, 1.50, 'Piotr Zielinski',            'individual', 'piotr.z@example.com',       '027 555 0459');

insert into owners (id, name, owner_type, email, phone, city, status)
select distinct on (s.owner_name)
       seed_uuid('owner:' || s.owner_name), s.owner_name, s.owner_type, s.email, s.phone, 'Wellington', 'active'
from seed_lots s
order by s.owner_name
on conflict do nothing;

insert into lots (id, ref, scheme_id, lot_number, unit_label, lot_type, bedrooms, utility_interest, status)
select seed_uuid('lot:' || s.ref), s.ref, seed_uuid('scheme:' || s.code), s.lot_number, s.unit_label,
       s.lot_type, s.beds, s.interest, 'active'
from seed_lots s
on conflict do nothing;

insert into lot_owners (id, lot_id, owner_id, is_primary, since_on)
select seed_uuid('lo:' || s.ref), seed_uuid('lot:' || s.ref), seed_uuid('owner:' || s.owner_name), true,
       current_date - 700
from seed_lots s
on conflict do nothing;

-- Committees ----------------------------------------------------------------------

insert into committee_members (id, scheme_id, owner_id, role, since_on)
select seed_uuid('cm:' || v.code || ':' || v.owner), seed_uuid('scheme:' || v.code), seed_uuid('owner:' || v.owner),
       v.role, current_date - v.days
from (values
  ('HVA', 'Graham Southee',    'chairperson',      760),
  ('HVA', 'Annette Pryor',     'committee member', 760),
  ('HVA', 'Duncan Blackie',    'committee member', 420),
  ('MIL', 'Fiona Marsh',       'chairperson',      370),
  ('MIL', 'Ari Goldsmith',     'committee member', 370),
  ('CQT', 'Derek Hoyle',       'chairperson',      120),
  ('CQT', 'Ingrid Sanders',    'committee member', 120),
  ('KEL', 'Judith Kaipara',    'chairperson',      300),
  ('KEL', 'Ross Delaney',      'committee member', 300),
  ('KEL', 'Aroha Tamihana',    'committee member', 300),
  ('VSC', 'Bernard Quill',     'chairperson',      200),
  ('VSC', 'Mei Lin Chong',     'committee member', 200),
  ('OPE', 'Simone Beaumont',   'chairperson',       62),
  ('OPE', 'Gilbert Fong',      'committee member',  62),
  ('OPE', 'Camille Duret',     'committee member',  62)
) as v(code, owner, role, days)
on conflict do nothing;

-- Levy runs -----------------------------------------------------------------------
-- Four operating quarters per scheme (three fallen due, one struck for next
-- quarter) and one maintenance fund levy. Charges split by utility interest.

insert into levy_runs (id, scheme_id, fund, name, struck_on, due_on, total_cents, note)
select seed_uuid('levy:' || v.code || ':' || v.name), seed_uuid('scheme:' || v.code), v.fund, v.name,
       current_date + v.struck, current_date + v.due, v.total, ''
from (values
  ('HVA', 'operating',   'Operating levy Q1',     -242, -200, 1680000),
  ('HVA', 'operating',   'Operating levy Q2',     -152, -110, 1680000),
  ('HVA', 'operating',   'Operating levy Q3',      -62,  -20, 1680000),
  ('HVA', 'operating',   'Operating levy Q4',      -10,   70, 1680000),
  ('HVA', 'maintenance', 'Maintenance fund levy', -107,  -65,  960000),
  ('MIL', 'operating',   'Operating levy Q1',     -257, -215,  792000),
  ('MIL', 'operating',   'Operating levy Q2',     -167, -125,  792000),
  ('MIL', 'operating',   'Operating levy Q3',      -83,  -41,  792000),
  ('MIL', 'operating',   'Operating levy Q4',      -10,   49,  792000),
  ('MIL', 'maintenance', 'Maintenance fund levy', -122,  -80,  540000),
  ('CQT', 'operating',   'Operating levy Q1',     -232, -190,  690000),
  ('CQT', 'operating',   'Operating levy Q2',     -142, -100,  690000),
  ('CQT', 'operating',   'Operating levy Q3',      -52,  -10,  690000),
  ('CQT', 'operating',   'Operating levy Q4',      -10,   80,  690000),
  ('CQT', 'maintenance', 'Maintenance fund levy',  -97,  -55,  480000),
  ('KEL', 'operating',   'Operating levy Q1',     -237, -195, 1104000),
  ('KEL', 'operating',   'Operating levy Q2',     -147, -105, 1104000),
  ('KEL', 'operating',   'Operating levy Q3',      -55,  -13, 1104000),
  ('KEL', 'operating',   'Operating levy Q4',      -10,   77, 1104000),
  ('KEL', 'maintenance', 'Maintenance fund levy', -102,  -60,  720000),
  ('VSC', 'operating',   'Operating levy Q1',     -282, -240, 1120000),
  ('VSC', 'operating',   'Operating levy Q2',     -192, -150, 1120000),
  ('VSC', 'operating',   'Operating levy Q3',     -106,  -64, 1120000),
  ('VSC', 'operating',   'Operating levy Q4',      -12,   30, 1120000),
  ('VSC', 'maintenance', 'Maintenance fund levy', -137,  -95,  640000),
  ('OPE', 'operating',   'Operating levy Q1',     -227, -185, 1300000),
  ('OPE', 'operating',   'Operating levy Q2',     -137,  -95, 1300000),
  ('OPE', 'operating',   'Operating levy Q3',      -50,   -8, 1300000),
  ('OPE', 'operating',   'Operating levy Q4',      -10,   82, 1300000),
  ('OPE', 'maintenance', 'Maintenance fund levy',  -92,  -50,  900000)
) as v(code, fund, name, struck, due, total)
on conflict do nothing;

insert into levy_charges (id, levy_run_id, lot_id, amount_cents)
select seed_uuid('charge:' || r.id || ':' || l.ref), r.id, l.id,
       round(r.total_cents * l.utility_interest / si.total_interest)::bigint
from levy_runs r
join lots l on l.scheme_id = r.scheme_id
join (select scheme_id, sum(utility_interest) as total_interest from lots group by scheme_id) si
  on si.scheme_id = r.scheme_id
on conflict do nothing;

-- Payments: every lot pays every levy that has fallen due, except the arrears
-- cases below. The ledger is a RECORD; the money lands in the body corporate's
-- own bank account.
insert into levy_payments (id, lot_id, paid_on, amount_cents, method, reference, note)
select seed_uuid('pay:' || r.id || ':' || l.ref), c.lot_id, r.due_on - 2, c.amount_cents,
       'direct credit', l.ref, 'Levy received'
from levy_charges c
join levy_runs r on r.id = c.levy_run_id
join lots l on l.id = c.lot_id
where r.due_on <= current_date
  and not exists (
    select 1 from (values
      ('HVA-07', 'Operating levy Q2'),
      ('HVA-07', 'Operating levy Q3'),
      ('HVA-07', 'Maintenance fund levy'),
      ('MIL-03', 'Operating levy Q3'),
      ('KEL-09', 'Operating levy Q3'),
      ('VSC-02', 'Operating levy Q3'),
      ('OPE-04', 'Operating levy Q3')
    ) as skip(lot_ref, run_name)
    where skip.lot_ref = l.ref and skip.run_name = r.name)
on conflict do nothing;

-- The arrears ladder, where it has actually been followed --------------------------

insert into arrears_events (id, lot_id, noted_on, action, days_behind, amount_cents, manager_id, note)
select seed_uuid('arr:' || v.ref || ':' || v.action || ':' || v.days_ago), seed_uuid('lot:' || v.ref),
       current_date - v.days_ago, v.action, v.behind, v.amount, seed_uuid('manager:' || v.manager), v.note
from (values
  ('HVA-07', 100, 'noted',         10, 101818, 'Caleb Foster', 'Q2 levy missed. No response to the levy notice.'),
  ('HVA-07',  92, 'reminder',      18, 101818, 'Caleb Foster', 'Reminder emailed and posted.'),
  ('HVA-07',  45, 'formal demand', 65, 261817, 'Tom Brandon',  'Formal demand issued. Owner says a refinance is settling next month.'),
  ('VSC-02',  30, 'reminder',      34, 174222, 'Caleb Foster', 'Reminder sent to the practice manager.')
) as v(ref, days_ago, action, behind, amount, manager, note)
on conflict do nothing;

-- Meetings and motions -------------------------------------------------------------

insert into meetings (id, scheme_id, kind, scheduled_on, notice_sent_on, held_on, minutes_sent_on, quorum_met, venue, manager_id, note)
select seed_uuid('meeting:' || v.code || ':' || v.kind || ':' || v.sched), seed_uuid('scheme:' || v.code), v.kind,
       case when v.sched is null then null else current_date + v.sched end,
       case when v.notice is null then null else current_date + v.notice end,
       case when v.held is null then null else current_date + v.held end,
       case when v.minutes is null then null else current_date + v.minutes end,
       v.quorum, v.venue, seed_uuid('manager:' || v.manager), v.note
from (values
  ('HVA', 'AGM',       -420, -440, -420, -410, true,  'Body corporate office',      'Tom Brandon',  'Last year''s AGM. This year''s is now past the s 89 deadline.'),
  ('MIL', 'AGM',       -370, -390, -370, -360, true,  'On site, unit 1',            'Priya Sharma', ''),
  ('MIL', 'AGM',          6,   -2, null, null, null,  'On site, unit 1',            'Priya Sharma', 'Notice went out late. Eight days instead of fourteen.'),
  ('CQT', 'AGM',       -120, -140, -120, -110, true,  'Roseneath community hall',   'Tom Brandon',  ''),
  ('CQT', 'committee',  -45,  -50,  -45,  -40, true,  'Video call',                 'Tom Brandon',  ''),
  ('KEL', 'AGM',       -300, -320, -300, -292, true,  'Kelburn bowling club',       'Priya Sharma', ''),
  ('VSC', 'AGM',       -200, -220, -200, -195, true,  'Suite 1 boardroom',          'Tom Brandon',  ''),
  ('OPE', 'AGM',        -62,  -80,  -62, null, true,  'On site, lobby',             'Priya Sharma', 'Minutes drafted and never circulated.'),
  ('OPE', 'EGM',         18,   -3, null, null, null,  'On site, lobby',             'Priya Sharma', 'Called to strike the remediation special levy.')
) as v(code, kind, sched, notice, held, minutes, quorum, venue, manager, note)
on conflict do nothing;

insert into motions (id, meeting_id, number, title, detail, kind, result, votes_for, votes_against, abstained)
select seed_uuid('motion:' || v.code || ':' || v.msched || ':' || v.num),
       seed_uuid('meeting:' || v.code || ':' || v.mkind || ':' || v.msched), v.num, v.title, v.detail, v.kind, v.result, v.vf, v.va, v.ab
from (values
  ('MIL', 'AGM',   6, 1, 'Adopt the financial statements for the year', '',                                                              'ordinary', 'pending', null, null, null),
  ('MIL', 'AGM',   6, 2, 'Strike the operating and maintenance fund levies for the coming year', '',                                     'ordinary', 'pending', null, null, null),
  ('MIL', 'AGM',   6, 3, 'Renew the management agreement with Harbour City for three years', '',                                         'ordinary', 'pending', null, null, null),
  ('MIL', 'AGM',   6, 4, 'Elect the body corporate committee', '',                                                                       'ordinary', 'pending', null, null, null),
  ('OPE', 'EGM',  18, 1, 'Strike a special levy of $180,000 to the maintenance fund for the north face remediation',
                         'Split by utility interest, payable in two instalments.',                                                       'special',  'pending', null, null, null),
  ('OPE', 'EGM',  18, 2, 'Approve the repaint colour scheme for the north face', '',                                                     'ordinary', 'pending', null, null, null),
  ('CQT', 'AGM', -120, 1, 'Adopt the financial statements for the year', '',                                                             'ordinary', 'carried', 5, 0, 1),
  ('CQT', 'AGM', -120, 2, 'Strike the operating and maintenance fund levies', '',                                                        'ordinary', 'carried', 6, 0, 0),
  ('CQT', 'AGM', -120, 3, 'Obtain two quotes for the retaining wall investigation', '',                                                  'ordinary', 'carried', 6, 0, 0),
  ('OPE', 'AGM',  -62, 1, 'Adopt the financial statements for the year', '',                                                             'ordinary', 'carried', 9, 0, 1),
  ('OPE', 'AGM',  -62, 2, 'Strike the operating and maintenance fund levies', '',                                                        'ordinary', 'carried', 10, 0, 0),
  ('OPE', 'AGM',  -62, 3, 'Adopt the thirty year long-term maintenance plan', '',                                                        'ordinary', 'carried', 8, 1, 1)
) as v(code, mkind, msched, num, title, detail, kind, result, vf, va, ab)
on conflict do nothing;

-- Insurance ------------------------------------------------------------------------

insert into insurance_policies (id, scheme_id, kind, insurer, broker, policy_number, sum_insured_cents, premium_cents,
                                excess_note, valuation_cents, valuation_on, started_on, expires_on, note)
select seed_uuid('policy:' || v.code || ':' || v.pol), seed_uuid('scheme:' || v.code), v.kind, v.insurer, v.broker,
       v.pol, v.sum, v.premium, v.excess,
       v.val, case when v.val_days is null then null else current_date - v.val_days end,
       current_date + v.started, current_date + v.expires, v.note
from (values
  ('HVA', 'principal',      'NZI',  'Crombie Lockwood', 'NZ-88231', 1420000000, 5480000, 'Natural disaster excess 2.5% of sum insured', 1390000000,  210, -175,  190, ''),
  ('MIL', 'principal',      'Vero', 'Crombie Lockwood', 'VP-33417',  680000000, 3120000, '',                                             640000000, 1170,  -65,  300, 'Sum insured still rests on the 2023 valuation.'),
  ('CQT', 'principal',      'AMI',  '',                 'AM-90121',  490000000, 2260000, '',                                             480000000,  380, -377,  -12, 'Renewal terms requested and never confirmed.'),
  ('KEL', 'principal',      'QBE',  'Marsh',            'QB-55672',  960000000, 4410000, '',                                             950000000,  200, -340,   25, ''),
  ('VSC', 'principal',      'Vero', 'Marsh',            'VP-71903',  740000000, 4890000, '',                                             710000000,  500, -205,  160, ''),
  ('VSC', 'liability',      'Vero', 'Marsh',            'VP-71904',  200000000,  180000, '',                                                      0, null, -205,  160, ''),
  ('OPE', 'principal',      'NZI',  'Crombie Lockwood', 'NZ-91544', 1850000000, 7660000, '',                                            1850000000,   90, -125,  240, ''),
  ('OPE', 'office bearers', 'NZI',  'Crombie Lockwood', 'NZ-91545',  100000000,   92000, '',                                                      0, null, -125,  240, '')
) as v(code, kind, insurer, broker, pol, sum, premium, excess, val, val_days, started, expires, note)
on conflict do nothing;

-- Compliance items -----------------------------------------------------------------
-- Seven per scheme, exempt where the obligation does not bite.

insert into compliance_items (id, scheme_id, kind, standard, status, assessed_on, due_on, note)
select seed_uuid('ci:' || v.code || ':' || v.kind), seed_uuid('scheme:' || v.code), v.kind, v.standard, v.status,
       case when v.assessed is null then null else current_date - v.assessed end,
       case when v.due is null then null else current_date + v.due end,
       v.note
from (values
  ('HVA', 'long-term maintenance plan review', 'Unit Titles Act 2010, s 116: plan covers at least 10 years, reviewed regularly',             'compliant',      400,  695, ''),
  ('MIL', 'long-term maintenance plan review', 'Unit Titles Act 2010, s 116',                                                                 'compliant',      700,  395, ''),
  ('CQT', 'long-term maintenance plan review', 'Unit Titles Act 2010, s 116',                                                                 'compliant',      900,  195, ''),
  ('KEL', 'long-term maintenance plan review', 'Unit Titles Act 2010, s 116',                                                                 'not compliant', 1290, -195, 'Last reviewed three and a half years ago. Quote for review requested.'),
  ('VSC', 'long-term maintenance plan review', 'Unit Titles Act 2010, s 116',                                                                 'compliant',      600,  495, ''),
  ('OPE', 'long-term maintenance plan review', 'Unit Titles Act 2010, s 116; thirty year plan adopted at the last AGM',                       'compliant',      200,  895, ''),
  ('HVA', 'insurance replacement valuation',   'Unit Titles Act 2010, s 135: principal insurance at full replacement value',                  'compliant',      210,  520, ''),
  ('MIL', 'insurance replacement valuation',   'Unit Titles Act 2010, s 135',                                                                 'not compliant', 1170, -440, 'Valuation is over three years old. Sum insured is a guess.'),
  ('CQT', 'insurance replacement valuation',   'Unit Titles Act 2010, s 135',                                                                 'compliant',      380,  350, ''),
  ('KEL', 'insurance replacement valuation',   'Unit Titles Act 2010, s 135',                                                                 'compliant',      200,  530, ''),
  ('VSC', 'insurance replacement valuation',   'Unit Titles Act 2010, s 135',                                                                 'compliant',      500,  230, ''),
  ('OPE', 'insurance replacement valuation',   'Unit Titles Act 2010, s 135',                                                                 'compliant',       90,  640, ''),
  ('HVA', 'building warrant of fitness',       'Building Act 2004, s 108: annual BWoF while a compliance schedule is in force',               'not compliant',   21,  -21, 'Expired three weeks ago. IQP inspection booked, certificate not issued.'),
  ('MIL', 'building warrant of fitness',       'Building Act 2004, s 108',                                                                    'exempt',        null, null, 'No compliance schedule on this building.'),
  ('CQT', 'building warrant of fitness',       'Building Act 2004, s 108',                                                                    'exempt',        null, null, 'No compliance schedule on this building.'),
  ('KEL', 'building warrant of fitness',       'Building Act 2004, s 108',                                                                    'exempt',        null, null, 'No compliance schedule on this building.'),
  ('VSC', 'building warrant of fitness',       'Building Act 2004, s 108',                                                                    'compliant',      155,  210, ''),
  ('OPE', 'building warrant of fitness',       'Building Act 2004, s 108',                                                                    'compliant',      215,  150, ''),
  ('HVA', 'financial statements and audit',    'Unit Titles Act 2010, s 132: statements prepared and audited unless opted out',               'compliant',      240,  120, ''),
  ('MIL', 'financial statements and audit',    'Unit Titles Act 2010, s 132',                                                                 'compliant',      145,  220, ''),
  ('CQT', 'financial statements and audit',    'Unit Titles Act 2010, s 132; audit opted out by ordinary resolution',                         'compliant',      120,  245, ''),
  ('KEL', 'financial statements and audit',    'Unit Titles Act 2010, s 132',                                                                 'compliant',       55,  310, ''),
  ('VSC', 'financial statements and audit',    'Unit Titles Act 2010, s 132',                                                                 'not compliant',  330, -140, 'Statements still in draft with the accountant. 140 days past the AGM pack date.'),
  ('OPE', 'financial statements and audit',    'Unit Titles Act 2010, s 132',                                                                 'compliant',       62,  300, ''),
  ('HVA', 'fire evacuation scheme',            'Fire and Emergency New Zealand Act 2017, s 76: approved evacuation scheme for relevant buildings', 'compliant', 300,  430, ''),
  ('MIL', 'fire evacuation scheme',            'Fire and Emergency New Zealand Act 2017, s 76',                                               'exempt',        null, null, 'Below the threshold for an approved scheme.'),
  ('CQT', 'fire evacuation scheme',            'Fire and Emergency New Zealand Act 2017, s 76',                                               'exempt',        null, null, ''),
  ('KEL', 'fire evacuation scheme',            'Fire and Emergency New Zealand Act 2017, s 76',                                               'exempt',        null, null, ''),
  ('VSC', 'fire evacuation scheme',            'Fire and Emergency New Zealand Act 2017, s 76',                                               'compliant',      250,  480, ''),
  ('OPE', 'fire evacuation scheme',            'Fire and Emergency New Zealand Act 2017, s 76',                                               'unknown',       null, null, 'Trial evacuation record not on file. Chase FENZ correspondence.'),
  ('HVA', 'asbestos register',                 'Health and Safety at Work (Asbestos) Regulations 2016: management plan where asbestos is present', 'compliant', 500, null, 'Survey 2024: none identified in common areas.'),
  ('MIL', 'asbestos register',                 'Health and Safety at Work (Asbestos) Regulations 2016',                                       'unknown',       null, null, '1975 building. No survey on file.'),
  ('CQT', 'asbestos register',                 'Health and Safety at Work (Asbestos) Regulations 2016',                                       'exempt',        null, null, 'Built 2006, after the 2000 cut-off.'),
  ('KEL', 'asbestos register',                 'Health and Safety at Work (Asbestos) Regulations 2016',                                       'compliant',      420, null, ''),
  ('VSC', 'asbestos register',                 'Health and Safety at Work (Asbestos) Regulations 2016',                                       'unknown',       null, null, '1968 building and no survey has ever been commissioned.'),
  ('OPE', 'asbestos register',                 'Health and Safety at Work (Asbestos) Regulations 2016',                                       'exempt',        null, null, 'Built 2012.'),
  ('HVA', 'pool barrier compliance',           'Building Act 2004, ss 162A to 162E: pool barrier inspected every three years',                'exempt',        null, null, 'No pool.'),
  ('MIL', 'pool barrier compliance',           'Building Act 2004, ss 162A to 162E',                                                          'exempt',        null, null, 'No pool.'),
  ('CQT', 'pool barrier compliance',           'Building Act 2004, ss 162A to 162E',                                                          'exempt',        null, null, 'No pool.'),
  ('KEL', 'pool barrier compliance',           'Building Act 2004, ss 162A to 162E',                                                          'exempt',        null, null, 'No pool.'),
  ('VSC', 'pool barrier compliance',           'Building Act 2004, ss 162A to 162E',                                                          'exempt',        null, null, 'No pool.'),
  ('OPE', 'pool barrier compliance',           'Building Act 2004, ss 162A to 162E',                                                          'compliant',     1075,   20, 'Three yearly inspection falls due in three weeks. Book the IQP.')
) as v(code, kind, standard, status, assessed, due, note)
on conflict do nothing;

-- Contractors ----------------------------------------------------------------------

insert into contractors (id, name, trade, contact_name, email, phone, licence_ref, licence_type, insurance_expires_on, preferred, active, notes)
select seed_uuid('contractor:' || v.name), v.name, v.trade, v.contact, v.email, v.phone, v.licence, v.ltype,
       current_date + v.ins_days, v.preferred, true, v.notes
from (values
  ('Wellington Lift Services',     'lift',       'Marty Keogh',     'marty@example.com',   '04 555 0701', '',            '',                                       200, true,  'Holds the HVA maintenance contract. 24 hour callout.'),
  ('Membrane Roofing Co',          'roofing',    'Dana Sullivan',   'dana@example.com',    '04 555 0702', 'LBP 118764',  'Licensed Building Practitioner',         150, true,  'Torch-on and TPO specialists.'),
  ('Capital Building Maintenance', 'building',   'Rob Ngata',       'rob@example.com',     '04 555 0703', 'LBP 104501',  'Licensed Building Practitioner',         240, true,  'General repairs across the portfolio.'),
  ('Pyrotec Fire Services',        'fire',       'Selina Vao',      'selina@example.com',  '04 555 0704', 'IQP WCC-221', 'Independent Qualified Person',            90, true,  'Does the BWoF inspections as well.'),
  ('AirFlow Mechanical',           'hvac',       'Grant Lissette',  'grant@example.com',   '04 555 0705', '',            '',                                       180, false, ''),
  ('Aqua Pool Services',           'pool',       'Nadia Petrova',   'nadia@example.com',   '04 555 0706', '',            '',                                       300, false, ''),
  ('Brightline Electrical',        'electrical', 'Josh Firmin',     'josh@example.com',    '04 555 0707', 'EWRB 88012',  'Electrical Workers Registration Board',  130, true,  ''),
  ('Greenway Grounds',             'grounds',    'Tipene Kohu',     'tipene@example.com',  '04 555 0708', '',            '',                                       -15, false, 'Public liability certificate has expired, chase it.')
) as v(name, trade, contact, email, phone, licence, ltype, ins_days, preferred, notes)
on conflict do nothing;

-- Maintenance ----------------------------------------------------------------------

insert into maintenance_requests (id, job_ref, scheme_id, lot_id, reported_on, reported_by, category, priority,
                                  summary, detail, status, habitability, committee_approval_required,
                                  committee_asked_on, committee_approved_on, approval_ref, approval_limit_cents,
                                  completed_on, closed_on, manager_id, note)
select seed_uuid('mnt:' || v.ref), v.ref, seed_uuid('scheme:' || v.code),
       case when v.lot is null then null else seed_uuid('lot:' || v.lot) end,
       current_date - v.reported, v.by, v.category, v.priority, v.summary, v.detail, v.status, v.hab, v.approval,
       case when v.asked is null then null else current_date - v.asked end,
       case when v.approved is null then null else current_date - v.approved end,
       v.approval_ref, v.limit_cents,
       case when v.completed is null then null else current_date - v.completed end,
       case when v.completed is null then null else current_date - v.completed end,
       seed_uuid('manager:' || v.manager), v.note
from (values
  ('MNT-3001', 'HVA', null,      5, 'resident',   'lift',       'urgent', 'Lift out of service, fault code on the controller',            'Original 1998 lift. Controller fault, parts on order. Two residents on upper floors have limited mobility.', 'in progress',                true,  false, null, null, '',                          680000, null, 'Tom Brandon',  'Committee told same day. Emergency work under the manager''s delegated authority.'),
  ('MNT-3002', 'HVA', 'HVA-12',  9, 'owner',      'roofing',    'high',   'Roof membrane leak staining the ceiling of unit 12',           'Water tracking along the ribs above unit 12 after northerlies. Membrane is at end of life over that bay.',   'scheduled',                  true,  true,     8,    6, 'Committee resolution 2026-14', 1240000, null, 'Tom Brandon',  ''),
  ('MNT-3003', 'CQT', null,     21, 'owner',      'building',   'normal', 'Retaining wall crack behind townhouses 4 to 6',                'Stepped crack, 8mm at the widest. Engineer recommends tie-back assessment. Quote $8,400.',                   'awaiting committee approval', false, true,    19, null, '',                          840000, null, 'Tom Brandon',  'Over the committee''s $1,500 delegation. Needs a resolution.'),
  ('MNT-3004', 'KEL', null,     30, 'committee',  'grounds',    'low',    'Exterior soft wash and moss treatment',                        'South face is green. Committee approved the $2,100 quote.',                                                  'approved',                   false, true,    16,    9, 'Flying minute 2026-07',      210000, null, 'Priya Sharma', 'Approved and then nothing has happened.'),
  ('MNT-3005', 'VSC', null,     50, 'owner',      'building',   'normal', 'Lobby door closer failed, door slamming',                      '',                                                                                                            'completed',                  false, true,    49,   48, 'Flying minute 2026-03',       48000,   40, 'Tom Brandon',  ''),
  ('MNT-3006', 'VSC', null,     38, 'owner',      'hvac',       'high',   'Air conditioning condenser dead on level 3',                   'Two suites without cooling. Replacement condenser approved by flying minute.',                               'completed',                  false, true,    36,   33, 'Flying minute 2026-05',      620000,   24, 'Tom Brandon',  ''),
  ('MNT-3007', 'OPE', null,      6, 'manager',    'pool',       'normal', 'Pool pump seal weeping',                                       'Caught at the weekly site check.',                                                                            'scheduled',                  false, true,     5,    4, 'Chair email 12 Sep',          92000, null, 'Priya Sharma', ''),
  ('MNT-3008', 'MIL', null,      3, 'owner',      'grounds',    'low',    'Gutter clean before winter',                                   '',                                                                                                            'new',                        false, true,  null, null, '',                                0, null, 'Priya Sharma', ''),
  ('MNT-3009', 'HVA', null,     60, 'owner',      'building',   'low',    'Upgrade the garage door remote system',                        'Owner request. Committee declined: works, not broken.',                                                      'declined',                   false, true,    55, null, '',                          320000,   50, 'Tom Brandon',  'Declined by the committee.'),
  ('MNT-3010', 'CQT', null,     75, 'resident',   'building',   'normal', 'Letterboxes vandalised',                                       '',                                                                                                            'completed',                  false, true,    74,   72, 'Flying minute 2026-01',       36000,   66, 'Tom Brandon',  ''),
  ('MNT-3011', 'OPE', null,      2, 'manager',    'fire',       'urgent', 'Fire alarm panel showing a defect on the sprinkler circuit',   'Panel in defect. Pyrotec attending. FENZ notified per the evacuation scheme.',                                'in progress',                true,  false, null, null, '',                          145000, null, 'Priya Sharma', 'Emergency work under the manager''s delegated authority.'),
  ('MNT-3012', 'KEL', null,     80, 'committee',  'electrical', 'normal', 'Stairwell lighting to LED',                                    '',                                                                                                            'completed',                  false, true,    78,   75, 'Committee resolution 2026-09', 310000,  62, 'Priya Sharma', '')
) as v(ref, code, lot, reported, by, category, priority, summary, detail, status, hab, approval, asked, approved, approval_ref, limit_cents, completed, manager, note)
on conflict do nothing;

insert into contractor_jobs (id, job_no, maintenance_id, contractor_id, issued_on, scheduled_on, completed_on,
                             quoted_cents, invoiced_cents, invoiced_on, invoice_ref, status, note)
select seed_uuid('job:' || v.job_no), v.job_no, seed_uuid('mnt:' || v.mnt), seed_uuid('contractor:' || v.contractor),
       current_date - v.issued,
       case when v.scheduled is null then null else current_date - v.scheduled end,
       case when v.completed is null then null else current_date - v.completed end,
       v.quoted,
       case when v.invoiced_days is null then 0 else v.invoiced end,
       case when v.invoiced_days is null then null else current_date - v.invoiced_days end,
       case when v.invoiced_days is null then null else 'INV-' || substr(md5(v.job_no), 1, 6) end,
       v.status, v.note
from (values
  ('JOB-4001', 'MNT-3001', 'Wellington Lift Services',      4,  -2, null,  680000,      0, null, 'scheduled', 'Controller board arriving Thursday.'),
  ('JOB-4002', 'MNT-3002', 'Membrane Roofing Co',           5,  -3, null, 1240000,      0, null, 'scheduled', 'Weather window dependent.'),
  ('JOB-4003', 'MNT-3005', 'Capital Building Maintenance', 47,  44,   40,   48000,  51750,   35, 'invoiced',  ''),
  ('JOB-4004', 'MNT-3006', 'AirFlow Mechanical',           32,  26,   24,  620000,      0, null, 'done',      'Work finished and no invoice has ever arrived.'),
  ('JOB-4005', 'MNT-3007', 'Aqua Pool Services',            3,  -4, null,   92000,      0, null, 'scheduled', ''),
  ('JOB-4006', 'MNT-3010', 'Capital Building Maintenance', 71,  68,   66,   36000,  36000,   60, 'invoiced',  ''),
  ('JOB-4007', 'MNT-3011', 'Pyrotec Fire Services',         1,   0, null,  145000,      0, null, 'scheduled', 'On site today.'),
  ('JOB-4008', 'MNT-3012', 'Brightline Electrical',        74,  66,   62,  310000, 298500,   58, 'invoiced',  '')
) as v(job_no, mnt, contractor, issued, scheduled, completed, quoted, invoiced, invoiced_days, status, note)
on conflict do nothing;

-- Disclosures ----------------------------------------------------------------------

insert into disclosure_requests (id, scheme_id, lot_id, kind, requested_on, requested_by, provided_on, manager_id, note)
select seed_uuid('disc:' || v.lot || ':' || v.requested), seed_uuid('scheme:' || v.code), seed_uuid('lot:' || v.lot),
       v.kind, current_date - v.requested, v.by,
       case when v.provided is null then null else current_date - v.provided end,
       seed_uuid('manager:' || v.manager), v.note
from (values
  ('KEL', 'KEL-05', 'pre-settlement', 13, 'Fenwick Conveyancing, for the Hastings sale', null, 'Priya Sharma', 'Settlement is meant to be next Friday. The five working days are long gone.'),
  ('OPE', 'OPE-07', 'pre-contract',    4, 'Bayleys, for the Reyes listing',              null, 'Priya Sharma', ''),
  ('HVA', 'HVA-03', 'pre-settlement', 30, 'Kettle Legal, for the Lindqvist sale',          27, 'Tom Brandon',  'Provided inside the statutory window.')
) as v(code, lot, kind, requested, by, provided, manager, note)
on conflict do nothing;

-- Tasks ----------------------------------------------------------------------------

insert into tasks (id, title, kind, due_on, status, scheme_id, manager_id, note)
select seed_uuid('task:' || v.title), v.title, v.kind, current_date + v.due, v.status,
       case when v.code is null then null else seed_uuid('scheme:' || v.code) end,
       seed_uuid('manager:' || v.manager), ''
from (values
  ('Chase Membrane Roofing for the unit 12 scope',            'maintenance',  -3, 'open', 'HVA', 'Tom Brandon'),
  ('Book the insurance revaluation for The Millhouse',        'insurance',   -10, 'open', 'MIL', 'Priya Sharma'),
  ('Confirm CQT renewal terms with the broker',               'insurance',    -5, 'open', 'CQT', 'Tom Brandon'),
  ('Prepare the Millhouse AGM pack',                          'meeting',       2, 'open', 'MIL', 'Priya Sharma'),
  ('Get asbestos survey quotes for Victoria Street Chambers', 'compliance',   14, 'open', 'VSC', 'Tom Brandon'),
  ('Confirm the venue for the Oriental Parade EGM',           'meeting',       7, 'open', 'OPE', 'Priya Sharma'),
  ('Put the Kelburn exterior wash on the next agenda',        'maintenance',   5, 'open', 'KEL', 'Priya Sharma'),
  ('Circulate the Oriental Parade AGM minutes',               'meeting',     -20, 'open', 'OPE', 'Priya Sharma')
) as v(title, kind, due, status, code, manager)
on conflict do nothing;

-- Contact log ----------------------------------------------------------------------

insert into contact_notes (id, happened_on, kind, who, body, scheme_id, lot_id, owner_id, manager_id)
select seed_uuid('note:' || v.days || ':' || v.body), current_date - v.days, v.kind, v.who, v.body,
       case when v.code is null then null else seed_uuid('scheme:' || v.code) end,
       case when v.lot is null then null else seed_uuid('lot:' || v.lot) end,
       case when v.owner is null then null else seed_uuid('owner:' || v.owner) end,
       seed_uuid('manager:' || v.manager)
from (values
  (  1, 'call',  'Simone Beaumont',  'Chair called about the fire panel. Told her Pyrotec are on site today and FENZ have been notified.',            'OPE', null, 'Simone Beaumont',  'Priya Sharma'),
  (  2, 'call',  'Graham Southee',   'Lift update to the chair. Controller board lands Thursday, fitted Friday. Mobility-affected residents rung.',   'HVA', null, 'Graham Southee',   'Tom Brandon'),
  (  4, 'email', 'Fiona Marsh',      'AGM pack queries from the chair. Flagged that the notice went out short and the meeting may need to re-issue.', 'MIL', null, 'Fiona Marsh',      'Priya Sharma'),
  (  7, 'email', 'Judith Kaipara',   'Chair asked when the soft wash is happening. No good answer: it was approved nine days ago and nobody booked.', 'KEL', null, 'Judith Kaipara',   'Priya Sharma'),
  (  9, 'call',  'Bernard Quill',    'Chair chasing the financial statements for the bank. Accountant says two more weeks. Again.',                   'VSC', null, 'Bernard Quill',    'Tom Brandon'),
  ( 30, 'email', 'Harcourt Dental',  'Reminder for the Q3 levy sent to the practice manager. Says the invoice went to an old email address.',         'VSC', 'VSC-02', 'Harcourt Dental Ltd', 'Caleb Foster'),
  ( 45, 'letter','Warren Dukes',     'Formal demand posted and emailed. Owner says a refinance settles next month and the arrears clear then.',       'HVA', 'HVA-07', 'Warren Dukes', 'Tom Brandon'),
  (104, 'call',  'Derek Hoyle',      'Retaining wall engineer report walked through with the chair. Committee to consider the quote.',                'CQT', null, 'Derek Hoyle',      'Tom Brandon'),
  (130, 'email', 'Ingrid Sanders',   'Sent the AGM minutes and the levy schedule.',                                                                   'CQT', null, 'Ingrid Sanders',   'Tom Brandon')
) as v(days, kind, who, body, code, lot, owner, manager)
on conflict do nothing;

drop table if exists seed_lots;
