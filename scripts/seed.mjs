#!/usr/bin/env node
// Loads supabase/seed.sql: Harbour City Body Corporate Management, a demo
// Wellington firm with four staff, six schemes, sixty one lots, committees,
// levy runs with arrears at four stages of the ladder, an AGM season in
// trouble, an insurance programme with holes in it and a compliance register
// with gaps. Every row has a derived id and inserts with ON CONFLICT DO
// NOTHING, so re-running it is harmless.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDb, REPO_ROOT } from './lib/db.mjs';

export async function seed(db) {
  const sql = readFileSync(path.join(REPO_ROOT, 'supabase', 'seed.sql'), 'utf8');
  await db.exec(sql);
  const [c] = await db.query(`
    select (select count(*) from schemes)              as schemes,
           (select count(*) from lots)                 as lots,
           (select count(*) from owners)               as owners,
           (select count(*) from committee_members)    as committee,
           (select count(*) from levy_runs)            as levy_runs,
           (select count(*) from levy_charges)         as levy_charges,
           (select count(*) from levy_payments)        as levy_payments,
           (select count(*) from arrears_events)       as arrears_events,
           (select count(*) from meetings)             as meetings,
           (select count(*) from motions)              as motions,
           (select count(*) from maintenance_requests) as maintenance,
           (select count(*) from contractors)          as contractors,
           (select count(*) from contractor_jobs)      as jobs,
           (select count(*) from insurance_policies)   as policies,
           (select count(*) from disclosure_requests)  as disclosures,
           (select count(*) from compliance_items)     as compliance_items,
           (select count(*) from tasks)                as tasks,
           (select count(*) from contact_notes)        as notes
  `);
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Number(v)]));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const db = await getDb();
  try {
    const n = await seed(db);
    console.log(
      `seed: ${n.schemes} schemes, ${n.lots} lots, ${n.owners} owners, ${n.committee} committee seats, ` +
        `${n.levy_runs} levy runs (${n.levy_charges} charges, ${n.levy_payments} payments), ${n.arrears_events} arrears events, ` +
        `${n.meetings} meetings (${n.motions} motions), ${n.maintenance} maintenance requests, ${n.contractors} contractors, ` +
        `${n.jobs} jobs, ${n.policies} insurance policies, ${n.disclosures} disclosures, ${n.compliance_items} compliance items, ` +
        `${n.tasks} tasks, ${n.notes} notes`,
    );
  } finally {
    await db.close();
  }
}
