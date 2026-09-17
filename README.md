<h1 align="center">Body Corporate for Claude Code</h1>

<p align="center">
  <strong>The open-source body corporate and strata management system that is just a database and Claude Code.</strong>
</p>

<p align="center">
  Created by <a href="https://www.enterprisedna.co"><strong>Enterprise DNA</strong></a>. Free and open source. Or installed and run for you.
</p>

<p align="center">
  <a href="#what-is-this">What is this</a> &bull;
  <a href="#why-no-front-end">Why no front end</a> &bull;
  <a href="#quick-start">Quick start</a> &bull;
  <a href="#the-commands">Commands</a> &bull;
  <a href="#compliance-checked-against-the-data">Compliance</a> &bull;
  <a href="#ten-questions-stratamax-cannot-answer">Ten questions</a> &bull;
  <a href="#instead-of-stratamax">Instead of StrataMax</a> &bull;
  <a href="#want-it-installed-and-run-for-you">Installed for you</a> &bull;
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node-20+-339933?style=flat-square" alt="Node 20+" />
  <img src="https://img.shields.io/badge/PostgreSQL-any-336791?style=flat-square" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/PGlite-embedded-3ecf8e?style=flat-square" alt="PGlite" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License" />
</p>

---

## What is this

Body Corporate for Claude Code does the job you pay StrataMax for, as a Postgres database and a set of Claude Code commands. There is no web front end. You open the folder in [Claude Code](https://claude.com/claude-code) and ask for what you want in plain language. It runs the right query, and it can answer questions the StrataMax dashboard cannot.

It is built for a body corporate and strata management business: the schemes under management, the lots and their owners, the committees and their delegated limits, levy runs split by utility interest and the ledger behind the arrears list, general meetings with their motions and the statutory AGM deadline, common property maintenance and the contractor jobs under it, the insurance programme with the valuation each sum insured rests on, disclosure requests with their five working day clock, and the compliance register every scheme carries. The words are the words a body corporate manager already uses.

**The body corporate's money is not in here.** No bank account, no receipting into a bank, no payments out, no reconciliation, no audit file. That stays in the system that holds it today. This records what was struck, what came in, what is owed and what the manager must report. That boundary is deliberate.

```
/arrears                          who is behind on levies, how far, and the next rung of the ladder
/meetings-due                     every scheme against the s 89 AGM deadline, with the notice position
/agm-pack                         one scheme's AGM built end to end: date, agenda, notice, votes, minutes
/levies                           what has been struck, what has fallen due, what is outstanding
/insurance                        expiry, the valuation behind every sum insured, and the holes
/disclosures                      the statutory clock on every sale in every scheme
/maintenance                      everything open, worst first, and which committee it is waiting on
/scheme HVA                       one body corporate in full, including the gaps
/lot HVA-07                       one lot's whole levy file, ladder included
/compliance                       the Act and the regulations, run against your own records
/attention                        everything that wants a decision this week
/weekly-review                    the Monday review, written from three commands
```

One lot is one row. One levy charge is one row. One meeting notice carries the day it was sent and the day of the meeting, because the gap between those two is what the Unit Titles Act is mostly about.

## Why no front end

- The front end was only ever there because the database was hard to talk to. That is no longer true.
- Your data sits in plain Postgres tables you own. Any tool can read them. No export, no lock-in.
- No per-lot fee, no modules, no portal licences. Read [docs/why-no-front-end.md](docs/why-no-front-end.md) for the honest trade-offs too, starting with the owner portal.

## Quick start

Sixty seconds, no database install (an embedded Postgres runs inside Node):

```bash
git clone https://github.com/Enterprise-DNA-OS/body-corporate-for-claude-code.git
cd body-corporate-for-claude-code
npm install
npm run demo
```

`npm run demo` creates the database, loads Harbour City Body Corporate Management (a demo Wellington firm with four staff, six schemes, sixty one lots, an AGM season in trouble, arrears at four stages of the ladder, an expired insurance policy and a deliberately imperfect compliance register), then prints the arrears list, the AGM board, the attention list and the compliance check.

Then open the folder in Claude Code and type:

```
/arrears
```

Try `/attention`, `/meetings-due`, `/scheme HVA`, `/insurance`, `/compliance`, `/weekly-review`. When you are ready for real data, delete `.data/` and start with `/import`, or add schemes one at a time with `add scheme`.

Fill in the "Who this is for" block in [CLAUDE.md](CLAUDE.md) so drafts come out in your voice, and put your business name and colours in [brand.json](brand.json) so the levy notices and meeting notices come out with your name on them.

### Use it with your own Postgres or Supabase

Copy `.env.example` to `.env`, set `DATABASE_URL`, then `npm run migrate`. Same commands, shared data, no per-lot fee. A team shares one database: each person clones the repo, points at the same `DATABASE_URL`, sets `BC_MANAGER` to their own name, and works in their own Claude Code.

## The commands

| Command | What it does |
|---|---|
| `/arrears` | Who is behind on levies, how far, and the rung of the ladder the file is missing. |
| `/meetings-due` | Every scheme against the statutory AGM deadline, and whether the fourteen day notice actually went out. |
| `/agm-pack` | One scheme's AGM end to end: the date against the deadline, the agenda from the record, the notice, the votes, the minutes. |
| `/levies` | Every run: struck, due, outstanding. `levy strike` splits a new run across the lots by utility interest. |
| `/scheme` | One body corporate in full: lots, committee, levies, meetings, insurance, maintenance, compliance. |
| `/lot` | One lot's whole file: owner, charges, payments, the arrears ladder, disclosures. |
| `/owner` | One owner across the portfolio: lots, arrears, committee seats. |
| `/committee` | Who chairs each scheme, who sits, and the delegated spend limits approvals run under. |
| `/maintenance` | Everything open, worst first, and which committee it is waiting on. Raise, ask, approve with a resolution reference, decline, close. |
| `/job` | The contractor job: issue (refused until the committee approves), book, done, invoice. And the work nobody has invoiced. |
| `/insurance` | The programme: expiry, valuation age, premiums. Record renewals and revaluations, and get told when a sum insured falls under the valuation. |
| `/disclosures` | The five working day clock on every sale (UTA 2010 s 147), oldest first. |
| `/compliance-items` | The register per scheme: LTMP, valuation, BWoF, audit, fire evacuation scheme, asbestos, pool barrier. |
| `/compliance` | Eleven rules from the Act, the regulations and the Building Act, run against your records, each with its source. |
| `/attention` | Everything that wants a decision this week, worst first. |
| `/weekly-review` | The Monday review, written from three commands. |
| `/draft-arrears-letter` | The right rung of the ladder as a letter, from the ledger. Into `drafts/`. |
| `/draft-committee-update` | The note to a chairperson, from their scheme's own position. Into `drafts/`. |
| `/log` | A call, a receipt, an arrears step, a task. The small entries that keep the record true. |
| `/import` | Bring the portfolio across from StrataMax, PropertyIQ, Strata Master or a plain CSV. |
| `/customise` | Add a field, rename a fund, change a rule, in plain language. Writes and applies the migration. |
| `/new-view` | Add a read-only HTML dashboard from a description. |

Everything the commands do, the CLI does: `npm run strata -- help`. Any command takes `--json`.

### Documents and views, in your brand

```bash
npm run docs    # levy notices, arrears letters, meeting notices with agendas, scheme summaries, as HTML
npm run view    # the week and the portfolio, as read-only HTML dashboards
```

Both read [brand.json](brand.json), so your business name, logo and colours are one file away. Documents land in `docs-out/`, views in `views/`. Print either to PDF from the browser. `/new-view` adds a view, `documents.json` adds a document.

## Compliance, checked against the data

`/compliance` runs the rules in [docs/compliance.md](docs/compliance.md) against your records and reports what is breached. Each rule cites its source, with the section or regulation.

1. Hold the AGM within six months of the end of the financial year (Unit Titles Act 2010, s 89).
2. Fourteen days written notice of a general meeting (UTA 2010 and the Unit Titles Regulations 2011).
3. A long-term maintenance plan covering at least ten years, kept current (UTA 2010, ss 115 and 116).
4. Principal insurance in force at all times (UTA 2010, s 135).
5. A current replacement valuation behind the sum insured (s 135; three years is the business's own line).
6. Chase arrears up the ladder: reminder at thirty days, formal demand at sixty, recovery at ninety. Interest capped at ten percent a year (Unit Titles Regulations 2011).
7. Provide a pre-settlement disclosure statement within five working days (UTA 2010, s 147).
8. Financial statements prepared each year, audited unless opted out (UTA 2010, s 132).
9. Work over the committee's delegated limit is not committed without an approval on file.
10. A current building warrant of fitness wherever a compliance schedule is in force (Building Act 2004, s 108).
11. Minutes of every meeting kept, and sent to owners within a month.

The Australian equivalents (NSW Strata Schemes Management Act 2015, QLD Body Corporate and Community Management Act 1997) are in the same file, at a high level, with the sections to read. Nothing there is legal advice. It is the rule book you point the system at, and you change it to match your jurisdiction and your management agreements. This is the feature the incumbent gates behind its modules.

## Ten questions StrataMax cannot answer

Every one of these is answered by the demo data today. Yours will be different, and that is the point.

1. Which schemes are within ninety days of their AGM deadline with nothing booked, and how many clear days are left once the fourteen day notice is counted?
2. Which lots have been in arrears more than twice in two years, and does the pattern line up with the levy due dates or with the owner?
3. Which schemes have a sum insured that has not moved since the valuation behind it, and what would a claim shortfall look like at today's build costs?
4. How many days does each committee take between being asked and deciding, and which chairperson is the bottleneck across the portfolio?
5. Which schemes generate the most maintenance jobs per lot, and are their maintenance fund levies anywhere near the spend?
6. What is the total base fee income per manager, per year, against the number of lots and meetings each one carries?
7. Which contractors invoice over their quote most often, by how much, and on which schemes?
8. Which management agreements expire inside six months, and what is the annual fee at risk on each?
9. If a manager left tomorrow, which schemes, committees, open arrears files and booked meetings move, and which of those meetings still need notices?
10. Which disclosure requests in the last year went out late, and did the same scheme or the same manager keep appearing?

## Your first hour: ten things to ask for

Open the folder in Claude Code and say these in your own words. Each one changes the system to fit your business.

1. "Our levies are quarterly on the first of March, June, September and December. Set that rhythm up for every scheme."
2. "Put our logo and colours on the levy notices, and change the business name to ours."
3. "Add a 'building manager' contact to every scheme and show it on the scheme card."
4. "Our arrears ladder is 14, 30 and 60 days, not 30, 60 and 90. Change the ladder and the letters."
5. "Track the lift maintenance contract per scheme with its expiry, and warn me sixty days out."
6. "Add a rule to `/compliance`: no scheme without a current committee chairperson on file."
7. "We are in New South Wales. The AGM rules, the capital works fund and the ten year plan follow the Strata Schemes Management Act 2015; rebuild the compliance file on that."
8. "Build me a page per manager for Monday: their schemes' arrears, their meetings, their committee bottlenecks."
9. "Add a 'proxy register' to meetings so quorum counts proxies separately."
10. "Write me a command that drafts the pre-settlement disclosure statement from the lot's file."

`/customise` writes the migration, applies it, updates every command that touches the change, and runs the tests.

## Instead of StrataMax

Export the building list and the roll, run one command, and the portfolio comes with you. Step by step, with what maps and what does not: [docs/replace-stratamax.md](docs/replace-stratamax.md).

```bash
npm run strata -- import stratamax --schemes=schemes.csv --lots=lots.csv --dry-run
npm run strata -- import stratamax --schemes=schemes.csv --lots=lots.csv
```

PropertyIQ and Strata Master exports go through the same command with `propertyiq` or `strata-master` in place of `stratamax`. Anything else works with `csv`.

Every scheme that comes across gets its seven compliance items created as "unknown", because the system will not tell you a building is compliant just because the old one did not say otherwise.

## Architecture

```
body-corporate-for-claude-code/
  CLAUDE.md                              how the business wants this run (routing table + house rules)
  brand.json                             your business name, logo and colours on every document and view
  views.json                             the HTML dashboards npm run view renders
  documents.json                         the paperwork npm run docs renders
  .claude/commands/                      the slash commands
  scripts/strata.mjs                     the CLI the commands drive
  scripts/view.mjs                       read-only HTML dashboards from the SQL views
  scripts/docs.mjs                       the documents, one HTML file per record
  scripts/lib/db.mjs                     one adapter: DATABASE_URL (pg) or embedded PGlite
  supabase/migrations/                   plain SQL schema, tables and views
  supabase/seed.sql                      demo data
  docs/compliance.md                     the rules /compliance checks, each with its source
  docs/replace-stratamax.md              moving off the incumbent
  docs/why-no-front-end.md               the honest trade-offs
  exports/                               whole database dumps
  drafts/                                letters and updates written for a person to send
```

## Built with Claude Code

This repository was built with Claude Code as the primary development tool, from the schema to the commands, and it is meant to be extended the same way. Ask for a new command and it writes one.

## Contributing

Issues and pull requests are welcome. Keep the shape: plain SQL, a small CLI, a slash command per recurring job, no front end, and no client money.

## Want it installed and run for you?

Enterprise DNA installs Body Corporate for Claude Code for your business, migrates your StrataMax data, connects it to the rest of your tools, and runs it for you as part of **Omni**, our managed Command Center. One setup fee, then a monthly retainer.

- Book a call: https://calendly.com/sam-mckay/discovery-call
- Read more: https://enterprisedna.co/omni/instead-of/stratamax

## License

MIT. Copyright (c) 2026 Enterprise DNA.
