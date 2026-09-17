#!/usr/bin/env node
// End-to-end smoke test on a throwaway embedded database.
// Runs migrate, seed, then every CLI command that matters, and asserts on the JSON.
// Passes on Windows and Linux. No network, no Postgres install.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = mkdtempSync(path.join(tmpdir(), 'strata-smoke-'));
const env = { ...process.env, DATA_DIR: dataDir };
delete env.DATABASE_URL; // the smoke test always runs embedded
delete env.BC_MANAGER;

let step = 0;
function run(label, args, { json = true, expectFail = false } = {}) {
  step++;
  const argv = [path.join(root, 'scripts', args[0]), ...args.slice(1), ...(json ? ['--json'] : [])];
  const res = spawnSync(process.execPath, argv, { cwd: root, env, encoding: 'utf8' });
  const ok = expectFail ? res.status !== 0 : res.status === 0;
  if (!ok) {
    console.error(`\nFAIL step ${step} (${label}): exit ${res.status}\n--- stdout\n${res.stdout}\n--- stderr\n${res.stderr}`);
    process.exit(1);
  }
  console.log(`  ok  ${String(step).padStart(2)}  ${label}`);
  if (!json || expectFail) return { stdout: res.stdout, stderr: res.stderr };
  try {
    return JSON.parse(res.stdout);
  } catch {
    console.error(`\nFAIL step ${step} (${label}): output is not JSON\n${res.stdout}\n${res.stderr}`);
    process.exit(1);
  }
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`\nFAIL assertion: ${msg}`);
    process.exit(1);
  }
}

const n = (v) => Number(v ?? 0);
const iso = (v) => String(v ?? '').slice(0, 10);
// Local date, the same way the CLI computes "today". Never UTC: New Zealand is a day ahead of it.
const todayIso = (() => {
  const d = new Date();
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
})();

console.log(`smoke: data dir ${dataDir}`);
try {
  run('migrate', ['migrate.mjs'], { json: false });
  run('migrate again (idempotent)', ['migrate.mjs'], { json: false });
  run('seed', ['seed.mjs'], { json: false });
  run('seed again (idempotent)', ['seed.mjs'], { json: false });

  // ---- the portfolio -------------------------------------------------------

  const schemes = run('schemes', ['strata.mjs', 'schemes']);
  assert(schemes.length === 6, `six schemes under management (${schemes.length})`);
  assert(schemes.reduce((a, s) => a + n(s.lots), 0) === 61, 'sixty one lots across them');
  assert(schemes.some((s) => n(s.arrears_cents) > 0), 'schemes carrying arrears');
  assert(schemes.every((s) => s.scheme_code && s.manager), 'every scheme has a code and a manager');

  const scheme = run('scheme card', ['strata.mjs', 'scheme', 'CQT']);
  assert(scheme.scheme.name === 'Clyde Quay Terraces', 'resolved by code');
  assert(scheme.lots.length === 6 && scheme.committee.length === 2, 'with its lots and its committee');
  assert(scheme.compliance.length === 7, 'seven compliance items on every scheme');
  assert(scheme.insurance.length >= 1 && iso(scheme.insurance[0].expires_on) < todayIso, 'and the expired policy shows');

  const byName = run('scheme resolved by partial name', ['strata.mjs', 'scheme', 'Millhouse']);
  assert(byName.scheme.code === 'MIL', 'partial name matching works');

  const noSuch = run('an unknown scheme exits 1', ['strata.mjs', 'scheme', 'nowhere at all'], { json: false, expectFail: true });
  assert(/No scheme matches/.test(noSuch.stderr), 'and says so plainly');

  const lots = run('lots', ['strata.mjs', 'lots']);
  assert(lots.length === 61, `the whole roll (${lots.length})`);
  assert(lots.some((l) => n(l.arrears_cents) > 0), 'with the lots in arrears');

  const lotsOfScheme = run('lots for one scheme', ['strata.mjs', 'lots', '--scheme=HVA']);
  assert(lotsOfScheme.length === 16 && lotsOfScheme.every((l) => l.scheme_code === 'HVA'), 'one scheme, its own roll');

  const lot = run('lot card', ['strata.mjs', 'lot', 'HVA-07']);
  assert(lot.position.owners === 'Warren Dukes', 'resolved by reference');
  assert(lot.arrears && n(lot.arrears.days_behind) >= 90, 'this one is a long way behind');
  assert(lot.events.length === 3, 'and the ladder is on file');
  assert(lot.charges.length === 5 && lot.payments.length === 1, 'charges and the one payment that came in');

  const byOwnerName = run('lot resolved by owner name', ['strata.mjs', 'lot', 'Warren Dukes']);
  assert(byOwnerName.lot.ref === 'HVA-07', 'you can look up a lot by who owns it');

  const ambiguous = run('an ambiguous unit label lists the candidates and exits 1', ['strata.mjs', 'lot', 'Apt 1'], {
    json: false,
    expectFail: true,
  });
  assert(/matches \d+ lot records/.test(ambiguous.stderr), 'it lists the candidates rather than guessing');

  const owners = run('owners', ['strata.mjs', 'owners']);
  assert(owners.length === 59, `every owner (${owners.length})`);
  assert(owners.some((o) => o.owner_type === 'trust') && owners.some((o) => o.owner_type === 'company'), 'trusts and companies as well as people');

  const owner = run('owner card', ['strata.mjs', 'owner', 'Judith Kaipara']);
  assert(owner.lots.length === 2, 'an investor with two lots is one owner');
  assert(owner.committee.some((c) => c.role === 'chairperson'), 'and her committee seat shows');

  const committees = run('committee', ['strata.mjs', 'committee']);
  assert(committees.length === 15, `every committee seat (${committees.length})`);
  assert(committees.filter((c) => c.role === 'chairperson').length === 6, 'a chairperson per scheme');

  // ---- arrears (read the position BEFORE anything mutates) -----------------

  const arrears = run('arrears', ['strata.mjs', 'arrears']);
  assert(arrears.length === 5, `five lots behind (${arrears.length})`);
  assert(arrears[0].lot_ref === 'HVA-07' && n(arrears[0].days_behind) >= 100, 'worst first');
  assert(/debt recovery/i.test(arrears[0].next_step), 'and the next step is recovery');
  assert(arrears.some((a) => /formal demand/.test(a.next_step)), 'one needs the formal demand');
  assert(arrears.some((a) => /reminder/i.test(a.next_step)), 'one has not even had a reminder');
  assert(arrears.every((a) => n(a.arrears_cents) > 0), 'every row owes money');

  const serious = run('arrears --min-days=60', ['strata.mjs', 'arrears', '--min-days=60']);
  assert(serious.length === 2, 'two are past sixty days');

  const levies = run('levies', ['strata.mjs', 'levies']);
  assert(levies.length === 30, `every levy run (${levies.length})`);
  const arrearsTotal = arrears.reduce((a, r) => a + n(r.arrears_cents), 0);
  const outstandingTotal = levies.reduce((a, r) => a + n(r.outstanding_cents), 0);
  assert(arrearsTotal === outstandingTotal, `FIFO outstanding equals the arrears total (${outstandingTotal} vs ${arrearsTotal})`);
  assert(levies.some((r) => iso(r.due_on) > todayIso && n(r.outstanding_cents) === 0), 'future runs are not counted as outstanding');

  // ---- meetings (read before mutating) --------------------------------------

  const agmSeason = run('meetings-due', ['strata.mjs', 'meetings-due']);
  assert(agmSeason.length === 6, 'every scheme on the AGM board');
  const hva = agmSeason.find((r) => r.scheme_code === 'HVA');
  assert(hva && n(hva.days_to_deadline) < 0 && !hva.agm_held_this_year && !hva.agm_booked, 'HVA is past the s 89 deadline');
  const mil = agmSeason.find((r) => r.scheme_code === 'MIL');
  assert(mil && mil.agm_booked && n(mil.notice_days) < 14, 'MIL is booked but the notice went out short');

  const meetings = run('meetings', ['strata.mjs', 'meetings']);
  assert(meetings.some((m) => m.held_on && !m.minutes_sent_on), 'a meeting whose minutes never went out');
  assert(meetings.some((m) => n(m.pending_motions) > 0), 'and motions still waiting on a vote');

  // ---- insurance and disclosures (read before mutating) ---------------------

  const insurance = run('insurance', ['strata.mjs', 'insurance']);
  assert(insurance.length === 8, `the whole programme (${insurance.length})`);
  assert(insurance.some((p) => n(p.days_to_expiry) < 0), 'one policy has EXPIRED');
  assert(insurance.some((p) => n(p.days_to_expiry) >= 0 && n(p.days_to_expiry) <= 30), 'one expires inside thirty days');
  assert(insurance.some((p) => p.kind === 'principal' && n(p.valuation_age_days) > 1095), 'one sum insured rests on a stale valuation');

  const disclosures = run('disclosures', ['strata.mjs', 'disclosures']);
  assert(disclosures.length === 2, 'two disclosure requests open');
  assert(disclosures.some((d) => n(d.working_days_open) > 5), 'and one is past the five working days');

  // ---- maintenance (read before mutating) ------------------------------------

  const maintenance = run('maintenance', ['strata.mjs', 'maintenance']);
  assert(maintenance.length >= 7, `open maintenance (${maintenance.length})`);
  assert(maintenance[0].priority === 'urgent', 'urgent first');
  assert(maintenance.some((m) => m.habitability), 'the demo has habitability work open');
  assert(maintenance.some((m) => n(m.days_waiting_on_committee) >= 14), 'and work sitting on a committee for a fortnight');
  assert(maintenance.some((m) => m.committee_approved_on && !m.job_id), 'and one approved that nobody has actioned');

  const urgent = run('maintenance --urgent', ['strata.mjs', 'maintenance', '--urgent']);
  assert(urgent.length >= 3 && urgent.every((m) => m.priority === 'urgent' || m.habitability), 'the urgent filter works');

  const jobs = run('jobs', ['strata.mjs', 'jobs']);
  assert(jobs.some((j) => j.completed_on && !j.invoiced_on), 'the demo has finished work nobody has invoiced');

  const contractors = run('contractors', ['strata.mjs', 'contractors']);
  assert(contractors.length === 8, 'the trade list');
  assert(contractors.some((c) => c.insurance_expires_on && iso(c.insurance_expires_on) < todayIso), 'and one whose insurance has lapsed');

  // ---- the compliance check, against the untouched seed ----------------------

  const compliance = run('compliance', ['strata.mjs', 'compliance']);
  assert(compliance.length === 11, `eleven rules (${compliance.length})`);
  assert(compliance.every((r) => r.source && /Act|Regulations/.test(r.source)), 'every rule cites its source');
  const byKey = Object.fromEntries(compliance.map((r) => [r.key, r]));
  assert(byKey['agm-deadline'].breaches === 1, 'the overdue AGM is found');
  assert(byKey['meeting-notice'].breaches === 1, 'and the eight day notice');
  assert(byKey['ltmp-review'].breaches === 1, 'and the stale maintenance plan');
  assert(byKey['insurance-cover'].breaches === 1, 'and the expired principal policy');
  assert(byKey['insurance-valuation'].breaches === 1, 'and the stale valuation');
  assert(byKey['levy-arrears-ladder'].breaches === 3, 'and the three arrears files missing a rung');
  assert(byKey['disclosure-clock'].breaches === 1, 'and the disclosure past five working days');
  assert(byKey['financial-statements'].breaches === 1, 'and the statements still in draft');
  assert(byKey['spend-approval'].breaches === 0, 'no job has been issued past the committee');
  assert(byKey['bwof'].breaches === 1, 'and the expired building warrant of fitness');
  assert(byKey['minutes'].breaches === 1, 'and the minutes that never went to owners');

  const oneRule = run('compliance <rule>', ['strata.mjs', 'compliance', 'agm-deadline']);
  assert(oneRule.length === 1 && oneRule[0].key === 'agm-deadline', 'a single rule can be run on its own');

  const unknownRule = run('an unknown rule exits 1', ['strata.mjs', 'compliance', 'not-a-rule'], { json: false, expectFail: true });
  assert(/No rule called/.test(unknownRule.stderr), 'and lists the ones that exist');

  // ---- the week ----------------------------------------------------------------

  const attention = run('attention', ['strata.mjs', 'attention']);
  assert(attention.length >= 25, `the attention list (${attention.length})`);
  const reasons = new Set(attention.map((a) => a.reason));
  for (const r of [
    'arrears_recovery', 'arrears_demand', 'arrears_reminder', 'arrears_watch', 'insurance_expired',
    'agm_overdue', 'meeting_short_notice', 'maintenance_habitability', 'disclosure_overdue',
    'insurance_expiring', 'valuation_stale', 'maintenance_committee_waiting', 'maintenance_no_contractor',
    'compliance_overdue', 'minutes_not_sent', 'job_not_invoiced', 'agreement_expiring', 'task_overdue', 'scheme_quiet',
  ]) {
    assert(reasons.has(r), `the attention list covers ${r}`);
  }
  assert(attention.every((a) => a.detail && a.detail.length > 10), 'every row says what is actually wrong');

  const mine = run('attention for one manager', ['strata.mjs', 'attention', '--manager=Priya']);
  assert(mine.length && mine.every((a) => a.manager === 'Priya Sharma'), 'and it filters by manager');

  const stats = run('stats', ['strata.mjs', 'stats']);
  assert(n(stats.schemes) === 6 && n(stats.lots) === 61, 'the portfolio adds up');
  assert(n(stats.lots_in_arrears) === 5 && n(stats.agms_overdue) === 1, 'and the trouble is counted');

  // ---- now the writes: the arrears ladder ---------------------------------------

  const logged = run('arrears-log', ['strata.mjs', 'arrears-log', 'MIL-03', 'reminder']);
  assert(logged.action === 'reminder', 'the step is recorded');
  const afterLog = run('the ladder moves on', ['strata.mjs', 'arrears']);
  const petra = afterLog.find((a) => a.lot_ref === 'MIL-03');
  assert(/Reminder is out/.test(petra.next_step), 'and the next step changes');

  const receipt = run('levy paid', ['strata.mjs', 'levy', 'paid', 'KEL-09', '--amount=901.22']);
  assert(n(receipt.amount_cents) === 90122, 'a receipt is a ledger row');
  const afterPayment = run('the payment clears the lot', ['strata.mjs', 'arrears']);
  assert(!afterPayment.some((a) => a.lot_ref === 'KEL-09'), 'and it drops off the arrears list');

  const struck = run('levy strike', ['strata.mjs', 'levy', 'strike', 'CQT', '--fund=operating', '--total=7200', `--due=${addDays(todayIso, 60)}`, '--name=Special quarter']);
  assert(struck.charges.length === 6, 'the run splits across all six lots');
  assert(struck.charges.every((c) => n(c.amount_cents) === 120000), 'equal interests, equal shares');
  const noNewArrears = run('a future levy creates no arrears', ['strata.mjs', 'arrears']);
  assert(!noNewArrears.some((a) => a.scheme_code === 'CQT'), 'nothing is owed before the due date');

  // ---- meetings, end to end -----------------------------------------------------

  const booked = run('meeting schedule', ['strata.mjs', 'meeting', 'schedule', 'KEL', '--kind=AGM', '--on=' + addDays(todayIso, 40)]);
  assert(booked.kind === 'AGM' && iso(booked.scheduled_on) === addDays(todayIso, 40), 'the AGM is booked');
  const meetingId = booked.id.slice(0, 8);

  const noticed = run('meeting notice', ['strata.mjs', 'meeting', 'notice', meetingId]);
  assert(iso(noticed.notice_sent_on) === todayIso, 'the notice is recorded, forty days out');

  const motion1 = run('motion add', ['strata.mjs', 'motion', 'add', meetingId, 'Adopt the financial statements for the year']);
  assert(motion1.number === 1 && motion1.result === 'pending', 'the agenda builds');
  run('motion add (special)', ['strata.mjs', 'motion', 'add', meetingId, 'Strike a special levy for the roof', '--kind=special']);

  const held = run('meeting held', ['strata.mjs', 'meeting', 'held', meetingId, '--quorum']);
  assert(iso(held.held_on) === todayIso && held.quorum_met === true, 'the meeting is recorded as held');

  const voted = run('motion result', ['strata.mjs', 'motion', 'result', meetingId, '1', 'carried', '--for=8', '--against=1', '--abstained=0']);
  assert(voted.result === 'carried' && n(voted.votes_for) === 8, 'the vote is on the record');

  const minutesSent = run('meeting minutes', ['strata.mjs', 'meeting', 'minutes', meetingId]);
  assert(iso(minutesSent.minutes_sent_on) === todayIso, 'and the minutes are marked sent');

  const kelAfter = run('the AGM board updates', ['strata.mjs', 'meetings-due']);
  assert(kelAfter.find((r) => r.scheme_code === 'KEL').agm_held_this_year === true, 'KEL has now held its AGM');

  const shortMeeting = run('meeting schedule with short runway', ['strata.mjs', 'meeting', 'schedule', 'CQT', '--kind=EGM', '--on=' + addDays(todayIso, 7)]);
  const shortNotice = run('a short notice warns out loud', ['strata.mjs', 'meeting', 'notice', shortMeeting.id.slice(0, 8)], { json: false });
  assert(/WARNING/.test(shortNotice.stdout) && /fourteen/.test(shortNotice.stdout), 'seven days of notice gets called out');

  // ---- maintenance, end to end ----------------------------------------------------

  const raised = run('maintenance new', ['strata.mjs', 'maintenance', 'new', 'MIL', 'Letterbox lock broken on the street frontage', '--priority=high', '--category=building']);
  assert(raised.job_ref && raised.status === 'new' && raised.priority === 'high', 'a request gets a reference');
  const mref = raised.job_ref;

  const blocked = run('a job cannot be issued before the committee approves', [
    'strata.mjs', 'job', 'issue', mref, 'Capital Building',
  ], { json: false, expectFail: true });
  assert(/has not been approved by the committee/.test(blocked.stderr), 'and it says so');

  run('maintenance ask', ['strata.mjs', 'maintenance', 'ask', mref, '--quote=380']);
  const approved = run('maintenance approve', ['strata.mjs', 'maintenance', 'approve', mref, '--ref=Flying minute 2026-11']);
  assert(iso(approved.committee_approved_on) === todayIso && approved.approval_ref === 'Flying minute 2026-11', 'the approval carries its resolution');

  const job = run('job issue', ['strata.mjs', 'job', 'issue', mref, 'Capital Building', '--quote=380']);
  assert(job.job_no && job.status === 'issued', 'the contractor has the job');
  const jobNo = job.job_no;

  run('job book', ['strata.mjs', 'job', 'book', jobNo, '--on=' + addDays(todayIso, 3)]);
  run('job done', ['strata.mjs', 'job', 'done', jobNo, '--complete']);
  const invoiced = run('job invoice', ['strata.mjs', 'job', 'invoice', jobNo, '--amount=402.50', '--ref=INV-7712']);
  assert(n(invoiced.invoiced_cents) === 40250 && invoiced.invoice_ref === 'INV-7712', 'the invoice is recorded against the job');

  const forced = run('maintenance new (emergency)', ['strata.mjs', 'maintenance', 'new', 'VSC', 'Burst pipe flooding the lobby', '--priority=urgent', '--habitability']);
  run('job issue --force for emergency work', ['strata.mjs', 'job', 'issue', forced.job_ref, 'Capital Building', '--force', '--note=Emergency under delegated authority']);
  const spendRule = run('the forced job shows on the spend rule', ['strata.mjs', 'compliance', 'spend-approval']);
  assert(spendRule[0].breaches === 1, 'a job issued past the committee is a visible breach, not a silent one');

  // ---- insurance and disclosures close out -----------------------------------------

  const revalued = run('insurance valuation', ['strata.mjs', 'insurance', 'valuation', 'MIL', '--amount=7100000']);
  assert(n(revalued.valuation_cents) === 710000000, 'the valuation is recorded');
  const underinsured = run('an underinsured scheme is called out', ['strata.mjs', 'insurance', 'valuation', 'MIL', '--amount=7100000'], { json: false });
  assert(/UNDER the valuation/.test(underinsured.stdout), 'the sum insured gap is said out loud');
  const valuationRule = run('the valuation rule clears', ['strata.mjs', 'compliance', 'insurance-valuation']);
  assert(valuationRule[0].breaches === 0, 'once the valuation is current');

  const renewed = run('insurance renew', ['strata.mjs', 'insurance', 'renew', 'AM-90121', '--expires=' + addDays(todayIso, 365), '--premium=24800']);
  assert(iso(renewed.expires_on) === addDays(todayIso, 365), 'the renewal is recorded');
  const coverRule = run('the cover rule clears', ['strata.mjs', 'compliance', 'insurance-cover']);
  assert(coverRule[0].breaches === 0, 'once the policy is in force');

  const provided = run('disclosure provide', ['strata.mjs', 'disclosure', 'provide', 'KEL-05'], { json: false });
  assert(/OUTSIDE the five working days/.test(provided.stdout), 'a late disclosure is marked late, not quietly closed');
  const clockRule = run('the disclosure clock clears', ['strata.mjs', 'compliance', 'disclosure-clock']);
  assert(clockRule[0].breaches === 0, 'once the statement goes out');

  const requested = run('disclosure request', ['strata.mjs', 'disclosure', 'request', 'HVA-05', '--kind=pre-settlement', '--by=Test Legal'], { json: false });
  assert(/Five working days/.test(requested.stdout), 'a new request states its deadline');

  const bwofDone = run('compliance-item done (BWoF)', ['strata.mjs', 'compliance-item', 'done', 'HVA', 'building warrant', '--evidence=BWoF-2026-1188', '--due=' + addDays(todayIso, 365)]);
  assert(bwofDone.status === 'compliant' && bwofDone.evidence_ref === 'BWoF-2026-1188', 'an item closes out with its evidence');
  const bwofRule = run('the BWoF rule clears', ['strata.mjs', 'compliance', 'bwof']);
  assert(bwofRule[0].breaches === 0, 'because the scheme record moves with the item');

  run('compliance-item done (LTMP)', ['strata.mjs', 'compliance-item', 'done', 'KEL', 'long-term maintenance']);
  const ltmpRule = run('the LTMP rule clears', ['strata.mjs', 'compliance', 'ltmp-review']);
  assert(ltmpRule[0].breaches === 0, 'the review date moves with the item');

  const items = run('compliance-items', ['strata.mjs', 'compliance-items']);
  assert(items.length >= 4, `compliance items still open (${items.length})`);

  // ---- housekeeping ------------------------------------------------------------------

  const tasks = run('tasks', ['strata.mjs', 'tasks']);
  assert(tasks.length >= 8, 'the task list');
  const added = run('task add', ['strata.mjs', 'task', 'add', 'Chase the Millhouse letterbox invoice', '--scheme=MIL', '--due=' + addDays(todayIso, 3)]);
  assert(added.title === 'Chase the Millhouse letterbox invoice' && iso(added.due_on) === addDays(todayIso, 3), 'a task lands with its date');
  const taskDone = run('task done', ['strata.mjs', 'task', 'done', added.id.slice(0, 8)]);
  assert(taskDone.status === 'done', 'and it closes');

  const schemeNote = run('note against a scheme', ['strata.mjs', 'note', 'CQT', 'Rang the chair about the retaining wall resolution', '--kind=call']);
  assert(schemeNote.scheme_id, 'a scheme note lands on the scheme');
  const lotNote = run('note against a lot', ['strata.mjs', 'note', 'HVA-07', 'Owner confirmed the refinance settles on the 28th', '--kind=call']);
  assert(lotNote.lot_id && lotNote.scheme_id, 'a lot note carries its scheme too');

  const committeeAdd = run('committee add', ['strata.mjs', 'committee', 'add', '--scheme=MIL', '--owner=Hemi Walker', '--role=committee member']);
  assert(committeeAdd.role === 'committee member', 'a seat can be filled');
  run('committee remove', ['strata.mjs', 'committee', 'remove', '--scheme=MIL', '--owner=Hemi Walker']);

  const newScheme = run('add scheme', ['strata.mjs', 'add', 'scheme', 'Test Terrace', '--code=TTX', '--suburb=Petone', '--fy-end=' + addDays(todayIso, -30), '--spend-limit=1500']);
  assert(newScheme.code === 'TTX', 'a scheme can be added');
  const newItems = run('a new scheme gets its compliance items', ['strata.mjs', 'compliance-items', '--scheme=TTX', '--all']);
  assert(newItems.length === 7 && newItems.every((c) => c.status === 'unknown'), 'seven items, all unknown until somebody assesses them');

  const newLot = run('add lot with a new owner', ['strata.mjs', 'add', 'lot', 'TTX', '--lot=1', '--unit=Unit 1', '--interest=1.2', '--owner=Test Owner']);
  assert(newLot.ref === 'TTX-01', 'the lot ref derives from the scheme code');
  const newLotCard = run('the new lot reads back', ['strata.mjs', 'lot', 'TTX-01']);
  assert(newLotCard.position.owners === 'Test Owner', 'with its owner linked');

  run('add contractor', ['strata.mjs', 'add', 'contractor', 'Test Trades Ltd', '--trade=building', '--phone=04 555 0000']);
  const newPolicy = run('add policy', ['strata.mjs', 'add', 'policy', '--scheme=TTX', '--kind=principal', '--insurer=Vero', '--sum=1200000', '--expires=' + addDays(todayIso, 300)]);
  assert(newPolicy.kind === 'principal', 'a policy can be added');

  // ---- import ---------------------------------------------------------------------

  const schemesCsv = path.join(dataDir, 'schemes.csv');
  const lotsCsv = path.join(dataDir, 'lots.csv');
  writeFileSync(
    schemesCsv,
    'Building Name,Plan Number,Address,Suburb\n' +
      'Aurora Court,DP 12345,9 Aurora Terrace,Te Aro\n' +
      '"Kupe, The",DP 67890,3 Kupe Street,Mount Victoria\n',
  );
  writeFileSync(
    lotsCsv,
    'Building Name,Lot Number,Unit Number,Unit Entitlement,Owner Name,Email,Phone\n' +
      'Aurora Court,1,Apt 1,100,Riley Wu,riley.wu@example.com,027 555 0901\n' +
      'Aurora Court,2,Apt 2,120,"Kereopa, Hine",hine.k@example.com,027 555 0902\n' +
      '"Kupe, The",1,Unit 1,1.0,Pacific Holdings Ltd,admin@example.com,04 555 0903\n' +
      'Ghost Building,4,Apt 4,100,Nobody Home,,\n',
  );

  const dry = run('import --dry-run', [
    'strata.mjs', 'import', 'stratamax', `--schemes=${schemesCsv}`, `--lots=${lotsCsv}`, '--dry-run',
  ]);
  assert(n(dry.schemes) === 2 && n(dry.lots) === 3 && dry.skipped.length === 1, 'the dry run says what it would do and what it would skip');
  const stillMissing = run('and changes nothing', ['strata.mjs', 'schemes', '--all']);
  assert(!stillMissing.some((s) => s.scheme === 'Aurora Court'), 'the dry run really is dry');

  const imported = run('import', ['strata.mjs', 'import', 'stratamax', `--schemes=${schemesCsv}`, `--lots=${lotsCsv}`]);
  assert(n(imported.schemes) === 2 && n(imported.lots) === 3 && n(imported.owners) === 3, 'everything with a home came across');

  const importedLot = run('the imported lot reads back', ['strata.mjs', 'lot', 'AC-02']);
  assert(importedLot.position.owners === 'Kereopa, Hine', 'a quoted comma in an owner name survives');
  assert(Number(importedLot.lot.utility_interest) === 120, 'the entitlement comes across as the interest');

  const reimport = run('re-importing updates rather than duplicating', [
    'strata.mjs', 'import', 'stratamax', `--schemes=${schemesCsv}`, `--lots=${lotsCsv}`,
  ]);
  assert(n(reimport.schemes) === 0 && n(reimport.schemes_updated) === 2 && n(reimport.lots) === 0, 'the second run creates nothing new');

  const missingFile = run('a missing import file fails loudly', [
    'strata.mjs', 'import', 'csv', `--schemes=${path.join(dataDir, 'not-there.csv')}`,
  ], { json: false, expectFail: true });
  assert(/No schemes file/.test(missingFile.stderr), 'it exits non zero rather than importing nothing quietly');

  // ---- export -------------------------------------------------------------------

  const outFile = path.join(dataDir, 'dump.json');
  const dump = run('export', ['strata.mjs', 'export', `--out=${outFile}`]);
  assert(existsSync(outFile), 'the export file is on disk');
  const parsed = JSON.parse(readFileSync(outFile, 'utf8'));
  assert(parsed.lots.length === n(dump.counts.lots), 'the counts match the file');
  assert(parsed.levy_charges.length > 300, 'the export carries the whole levy ledger');
  assert(!Object.keys(parsed).some((t) => /trust|bank|receipt_batch|disbursement/.test(t)), 'there is no client money in the export');

  // ---- the branded HTML -----------------------------------------------------------

  const views = run('npm run view', ['view.mjs'], { json: false });
  assert(/views[\\/]week\.html/.test(views.stdout) && /views[\\/]portfolio\.html/.test(views.stdout), 'both views rendered');
  const weekHtml = readFileSync(path.join(root, 'views', 'week.html'), 'utf8');
  assert(weekHtml.includes('Needs a decision') && weekHtml.includes('Levy arrears'), 'the week view has its sections');
  assert(weekHtml.includes('The AGM season') && weekHtml.includes('Disclosures open') && weekHtml.includes('Compliance not met'), 'and the rest of the week');
  const portfolioHtml = readFileSync(path.join(root, 'views', 'portfolio.html'), 'utf8');
  assert(portfolioHtml.includes('The schemes') && portfolioHtml.includes('The insurance programme'), 'the portfolio view has its sections');

  const docs = run('npm run docs', ['docs.mjs'], { json: false });
  assert(/levy-notice/.test(docs.stdout), 'the levy notices rendered');
  assert(/arrears-letter-draft/.test(docs.stdout), 'the arrears letter rendered');
  assert(/meeting-notice/.test(docs.stdout), 'the meeting notices rendered');
  assert(/scheme-annual-summary/.test(docs.stdout), 'the scheme summaries rendered');
  const summary = readFileSync(path.join(root, 'docs-out', 'scheme-annual-summary', 'harbour-view-apartments.html'), 'utf8');
  assert(summary.includes('Levies in the last twelve months') && summary.includes('Compliance'), 'the scheme summary has its sections');
  const letter = readFileSync(path.join(root, 'docs-out', 'arrears-letter-draft', 'hva-07-harbour-view-apartments.html'), 'utf8');
  assert(letter.includes('The next rung of the ladder') && letter.includes('draft'), 'the arrears letter is plainly a draft with the ladder attached');

  // ---- the human readable side ------------------------------------------------------

  run('schemes (text)', ['strata.mjs', 'schemes'], { json: false });
  run('scheme (text)', ['strata.mjs', 'scheme', 'HVA'], { json: false });
  run('lots (text)', ['strata.mjs', 'lots', '--scheme=OPE'], { json: false });
  run('lot (text)', ['strata.mjs', 'lot', 'VSC-02'], { json: false });
  run('owners (text)', ['strata.mjs', 'owners'], { json: false });
  run('owner (text)', ['strata.mjs', 'owner', 'Harcourt Dental'], { json: false });
  run('committee (text)', ['strata.mjs', 'committee', 'OPE'], { json: false });
  run('arrears (text)', ['strata.mjs', 'arrears'], { json: false });
  run('levies (text)', ['strata.mjs', 'levies', '--scheme=HVA'], { json: false });
  run('meetings-due (text)', ['strata.mjs', 'meetings-due'], { json: false });
  run('meetings (text)', ['strata.mjs', 'meetings'], { json: false });
  run('meeting (text)', ['strata.mjs', 'meeting', meetingId], { json: false });
  run('maintenance (text)', ['strata.mjs', 'maintenance'], { json: false });
  run('maintenance card (text)', ['strata.mjs', 'maintenance', 'MNT-3003'], { json: false });
  run('jobs (text)', ['strata.mjs', 'jobs', '--all'], { json: false });
  run('contractors (text)', ['strata.mjs', 'contractors'], { json: false });
  run('insurance (text)', ['strata.mjs', 'insurance'], { json: false });
  run('disclosures (text)', ['strata.mjs', 'disclosures'], { json: false });
  run('compliance-items (text)', ['strata.mjs', 'compliance-items'], { json: false });
  run('compliance (text)', ['strata.mjs', 'compliance'], { json: false });
  run('attention (text)', ['strata.mjs', 'attention'], { json: false });
  run('stats (text)', ['strata.mjs', 'stats'], { json: false });
  run('tasks (text)', ['strata.mjs', 'tasks', '--all'], { json: false });
  run('help', ['strata.mjs', 'help'], { json: false });
  run('an unknown command exits 1', ['strata.mjs', 'nonsense'], { json: false, expectFail: true });

  console.log(`\n${step} checks, PASS`);
} finally {
  if (existsSync(dataDir)) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // Windows can hold the handle briefly; a leftover temp dir is harmless.
    }
  }
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
