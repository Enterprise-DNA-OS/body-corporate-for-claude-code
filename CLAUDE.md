# Body Corporate for Claude Code: operating instructions

This file is the brain. Claude Code reads it at the start of every session. It says who this is for, how work gets done, and the one right way to do each recurring job.

## Who this is for

- **Business:** [YOUR BUSINESS], a body corporate / strata management business in [city, country]
- **Operator:** [YOUR NAME], [principal / body corporate manager / strata manager / owner]
- **The team:** [how many managers, how many schemes each, who runs the levy ledger, who runs the bank account]
- **The portfolio:** [how many schemes, how many lots, residential or mixed, which suburbs]
- **The levy rhythm:** [quarterly or annual, which months, and whether the maintenance fund levy is separate]
- **The arrears ladder:** [your own days: this repo ships with reminder at 30, formal demand at 60, recovery at 90]
- **Where the money lives:** [the system that receipts levies and pays invoices. It is not this one.]
- **What matters most:** [for example: no AGM ever misses the deadline, no building is ever uninsured for a day, arrears never reach recovery without every rung on file, committees hear from us before they have to ask]

Fill this in once. A worker with context knows. A worker without it guesses.

## How to work

1. **Take a brief, not a script.** The operator describes the outcome. You run the right command and present the answer.
2. **Read before you write.** Before drafting anything about a lot, run `lot <ref>` and read the whole file, ledger and ladder included. Before writing to a committee, run `scheme <code>` and read the contact log.
3. **Plain language.** Short sentences. No filler. Numbers in tables. The industry words, not software words: a scheme, a lot, an owner, a levy, utility interest, the committee, a general meeting, a motion, a special resolution, the long-term maintenance plan, a disclosure statement.
4. **Silent success, loud problems.** No play-by-play. Say what broke and what you did about it.
5. **Stop at the line.** Anything that sends, deletes, or faces an owner or a committee waits for a yes in this session.
6. **Never invent a number.** Levy amounts, sums insured, quotes and balances come from the operator or from the database. If one is missing, say which one.
7. **Never state a legal position you have not checked.** The AGM deadline, the notice period, the disclosure clock and the insurance duty are in `docs/compliance.md` with their sections. Quote the section. If the question is outside what is written there, say so.

## Routing table: one right way for each recurring job

| When the operator asks for... | Use this |
|---|---|
| Who is behind on levies, what do we do about it | `/arrears` |
| I sent the reminder, the demand went out, it went to recovery | `arrears-log <lot> "<rung>"` |
| Which AGMs are in trouble | `/meetings-due` |
| Run the whole AGM for a scheme | `/agm-pack` |
| Book a meeting, record the notice, the votes, the minutes | `meeting` and `motion` |
| Strike the levies, what is outstanding | `/levies` |
| A receipt came in | `levy paid <lot> --amount=` |
| Everything about one scheme, or what do I tell the chair | `/scheme` |
| Everything about one lot or one owner | `/lot`, `/owner` |
| Who is on the committee, the spend limit | `/committee` |
| Something broke on common property | `/maintenance` |
| Send a contractor, book them, record the invoice | `/job` |
| Are we insured, when does it expire, is the valuation current | `/insurance` |
| A lot is selling, the lawyer wants the statement | `/disclosures` |
| BWoF, LTMP, audit, asbestos, pool | `/compliance-items` |
| Are we breaking any of the rules we run under | `/compliance` |
| What needs a decision this week | `/attention` |
| The Monday review | `/weekly-review` |
| The letter to the owner about the levies | `/draft-arrears-letter` |
| The note to the chairperson | `/draft-committee-update` |
| I spoke to them, chase this, that is done | `/log` |
| Bring the portfolio over from the old system | `/import` |
| Change how this system works | `/customise` |
| A new page to look at | `/new-view` |
| The paperwork, in our brand | `npm run docs` |

If an ask fits nothing here, run the CLI directly (`npm run strata -- help`) and then propose a new command for it.

## Hard rules

- **No client money, ever.** This system does not receipt a levy into a bank, does not pay a contractor and does not reconcile an account. The levy ledger is a record so the arrears maths works, and nothing more. The body corporate's bank account stays in the system that holds it. If asked to add banking, say no and say why.
- Never send email or letters from here. Draft to `drafts/`, render with `npm run docs`, a person sends. That includes every levy notice, meeting notice and demand: this system records that something was sent, it does not send it.
- Never mark a committee approval the committee has not given. An approval is evidence of a decision, and it carries its resolution reference.
- Never issue a job past an outstanding approval without the operator saying it is an emergency, and the reason recorded in the note.
- Never record a meeting notice date that has not happened, and never mark minutes sent until they have been.
- Never serve or record a general meeting on less than fourteen days notice without flagging that everything it resolves is open to challenge.
- Never guess a levy balance for a disclosure statement. It is a legal document; every number comes from the ledger.
- Never delete records without an explicit yes in this session. A scheme that leaves is `status = 'former'`, a lot is `status = 'inactive'`. The file is a long record.
- Never invent a record. If a name or a reference is ambiguous, list the candidates and ask. The CLI already does this.
- The database is the source of truth. If the answer is not in it, say so.

## Words this business uses

- A **scheme** is one body corporate: one unit plan, one set of funds, one committee. A **lot** is one unit on that plan.
- **Utility interest** (or unit entitlement) is the share the levies split by. It comes off the plan, not off a guess.
- The **operating fund** pays the year's bills; the **maintenance fund** (long-term maintenance fund, capital works fund in NSW) saves for the plan. A levy is **struck** by resolution, then it falls **due**.
- An **ordinary resolution** is a simple majority of votes cast. A **special resolution** is seventy five percent. The difference decides what a meeting can do.
- The **AGM deadline** is six months after the financial year end (UTA 2010 s 89). The **notice period** for a general meeting is fourteen days, and it is counted in clear days to be safe.
- A **disclosure statement** is what a sale triggers: pre-contract before signing (s 146), pre-settlement within five working days of the request (s 147).
- The **LTMP** is the long-term maintenance plan: at least ten years, kept current. The **BWoF** is the building warrant of fitness, renewed every twelve months wherever a compliance schedule is in force.
- The **committee's delegated limit** is the spend it can approve without a general meeting. Over it, the body corporate decides.
- The **chairperson** is an owner and a volunteer. Write to them like one.

## Where things live

- `scripts/strata.mjs` the CLI. `scripts/lib/db.mjs` picks `DATABASE_URL` (Postgres, Supabase) or the embedded database in `.data/`.
- `supabase/migrations/` the schema, plain SQL. `npm run migrate` applies it. Never edit an applied migration; add the next one.
- `.claude/commands/` the slash commands. Add one every time the same ask comes twice.
- `brand.json`, `views.json`, `documents.json` the HTML output: whose name is on it, what pages, what paperwork.
- `docs/compliance.md` the rules `/compliance` checks, each with its source. `docs/replace-stratamax.md` moving off the incumbent. `docs/why-no-front-end.md` the honest trade-offs.
- `exports/` whole database dumps. `drafts/` anything written for a person to send.

Built by Enterprise DNA. Installed and run for you as part of Omni: https://enterprisedna.co/omni/instead-of/stratamax
