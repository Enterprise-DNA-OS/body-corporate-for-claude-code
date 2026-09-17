# The rules a body corporate management business lives under

This file is the rule book `/compliance` checks the database against. Each rule has a name, the
source it comes from, what a breach looks like in the data, the query or view that finds it and the
command that fixes it. `npm run strata -- compliance` runs all of them, and
`npm run strata -- compliance <key>` runs one.

Nothing here is legal advice. These are the rules the business has told this system to enforce.
Read them, change them to match your own jurisdiction and your own management agreements, and keep
the sources current. When a rule changes, change the rule and the check together.

The sources are New Zealand first, because that is where the reference business is. The Australian
equivalents are noted at the bottom at a high level, with the acts to read.

## What this system does not do

**The body corporate's money is not in here.** No bank account, no receipting of levies into a
bank, no payments to contractors, no reconciliation, no audit file. Each body corporate's funds sit
in their own account, in the accounting system that already holds them. A trust or client account
is a regulated obligation with an auditor attached, not a table.

What this system records is the management lifecycle: schemes, lots and owners, committees and
their delegated limits, levy runs and what was charged and received against them, arrears and the
ladder of steps behind each one, meetings and their motions, maintenance and the contractor jobs
under it, the insurance programme, disclosure requests with their statutory clock, and the
compliance register per scheme. The levy ledger is a record so the arrears maths works. It never
moves a cent.

---

## 1. Hold the AGM within six months of the end of the financial year

**Source.** Unit Titles Act 2010, s 89: a body corporate must hold an annual general meeting within
six months after the end of each financial year.

**What it means for a manager.** The deadline runs from the scheme's own financial year end, not
from the last AGM. Missing it is the single most visible failure a committee sees, and the pack
takes weeks to build, so the real deadline is earlier than the statutory one.

**Breach in the data.** A managed scheme whose deadline (`last_fy_end_on` plus six months) has
passed with no AGM held after the financial year end and none booked.

```sql
select scheme_code, scheme, agm_deadline, days_to_deadline
from v_agm_position
where days_to_deadline < 0 and not agm_held_this_year and not agm_booked;
```

**Command.** `compliance agm-deadline` lists them. `meeting schedule <scheme> --kind=AGM --on=`
books one and states the deadline position as it does.

---

## 2. Fourteen days written notice of a general meeting

**Source.** Unit Titles Act 2010 and the Unit Titles Regulations 2011, which govern the calling of
general meetings and the notice owners must receive. This business treats fourteen clear days as
the floor for an AGM or an EGM.

**What it means for a manager.** A meeting held on short notice invites a challenge to everything
it resolved, including the levies it struck. The safe fix for a short notice is to move the meeting
and re-issue, not to hope.

**Breach in the data.** An upcoming AGM or EGM whose notice is missing, or went out fewer than
fourteen days before the meeting.

```sql
select scheme_code, next_meeting_kind, next_meeting_on, notice_days
from v_agm_position
where next_meeting_on is not null and next_meeting_kind in ('AGM', 'EGM')
  and (notice_sent_on is null or notice_days < 14);
```

**Command.** `compliance meeting-notice`. `meeting notice <id>` records the send date and warns
out loud when it is short.

---

## 3. A long-term maintenance plan covering at least ten years, kept current

**Source.** Unit Titles Act 2010, ss 115 and 116: every body corporate must have a long-term
maintenance plan covering at least ten years. The Unit Titles (Strengthening Body Corporate
Governance and Other Matters) Amendment Act 2022 extends new plans to thirty years for larger
schemes. This business reviews every plan at least every three years.

**Breach in the data.** A managed scheme whose `ltmp_reviewed_on` is empty or more than three years
old, or whose plan covers fewer than ten years.

**Command.** `compliance ltmp-review`. `compliance-item done <scheme> "long-term maintenance"`
records a completed review and moves the scheme's review date with it.

---

## 4. Principal insurance in force at all times

**Source.** Unit Titles Act 2010, s 135: a body corporate must insure the buildings to their full
insurable value. An expired principal policy is an uninsured building.

**Breach in the data.** A managed scheme with no principal policy, or a principal policy whose
`expires_on` has passed.

**Command.** `compliance insurance-cover`. `insurance renew <policy> --expires=` records the
renewal the day the broker confirms it, not the day the invoice arrives.

---

## 5. A current replacement valuation behind the sum insured

**Source.** Unit Titles Act 2010, s 135 requires full replacement value, and a sum insured is only
as real as the valuation behind it. Three years is this business's own line for "the sum insured is
a guess"; build cost movements have made longer gaps indefensible.

**Breach in the data.** A principal policy with no `valuation_on`, or one more than three years old.

**Command.** `compliance insurance-valuation`. `insurance valuation <scheme> --amount=` records a
new valuation, clears the register item, and says out loud if the sum insured now sits under it.

---

## 6. Chase arrears up the ladder: reminder at thirty days, formal demand at sixty, recovery at ninety

**Source.** The ladder itself is the business's own service standard. Behind it: a levy is
recoverable from the owner as a debt under the Unit Titles Act 2010, and interest, where the body
corporate charges it on amounts unpaid, is capped at ten percent a year under the Unit Titles
Regulations 2011. A recovery file with missing rungs is a weak file.

**Breach in the data.** A lot ninety days behind with no recovery step, sixty days behind with no
formal demand, or thirty days behind with not even a reminder on file.

```sql
select lot_ref, scheme, days_behind, last_reminder_on, last_demand_on, recovery_started_on
from v_arrears
where (days_behind >= 90 and recovery_started_on is null)
   or (days_behind >= 60 and last_demand_on is null)
   or (days_behind >= 30 and last_reminder_on is null);
```

**Command.** `compliance levy-arrears-ladder` lists the missing rungs. `arrears-log <lot> "<rung>"`
records each one as it happens, and `/draft-arrears-letter` writes the letter for the rung the file
says is next.

---

## 7. Provide a pre-settlement disclosure statement within five working days

**Source.** Unit Titles Act 2010, s 147: a seller must provide a pre-settlement disclosure
statement, prepared with the body corporate's information, within five working days of the buyer's
request. Pre-contract disclosure before the buyer signs is s 146.

**What it means for a manager.** The clock is the buyer's, not yours, and a late statement can hold
up someone's settlement. Every number on the statement comes from the ledger, never from memory.

**Breach in the data.** An open pre-settlement request more than five working days old.

**Command.** `compliance disclosure-clock`. `disclosure request <lot>` starts the clock with its
due date stated; `disclosure provide <lot>` closes it and says plainly if it went out late.

---

## 8. Financial statements prepared each year, and audited unless the body corporate opts out

**Source.** Unit Titles Act 2010, s 132: a body corporate must prepare financial statements for
each financial year, audited unless it resolves not to.

**Breach in the data.** The `financial statements and audit` register item on a scheme is not
compliant and not exempt.

**Command.** `compliance financial-statements`. `compliance-item done <scheme> "financial
statements"` closes it out with the accountant's reference as evidence.

---

## 9. Work over the committee's delegated limit is not committed without an approval on file

**Source.** The body corporate's own delegation. The Act lets a body corporate delegate decisions
to its committee within limits it sets; each scheme's limit is on the scheme record. Committing the
body corporate past that limit without a resolution is spending someone else's money without
authority.

**Breach in the data.** A contractor job issued while the maintenance request's committee approval
is still outstanding.

**Command.** `compliance spend-approval`. `job issue` refuses this by default; `--force` exists for
genuine emergencies under the manager's own delegated authority, and the forced job stays visible
on this rule until the approval is recorded.

---

## 10. A current building warrant of fitness wherever a compliance schedule is in force

**Source.** Building Act 2004, s 108: where a building has a compliance schedule (lifts, fire
systems, and other specified systems), the building warrant of fitness must be renewed every twelve
months.

**Breach in the data.** A managed scheme flagged as having a compliance schedule whose
`bwof_expires_on` is empty or past.

**Command.** `compliance bwof`. `compliance-item done <scheme> "building warrant" --evidence=
--due=` records the new certificate and moves the scheme's expiry with it.

---

## 11. Minutes of every meeting kept, and sent to owners within a month

**Source.** The Unit Titles Regulations 2011 require minutes of general meetings to be kept. The
one month promise to circulate them is this business's own service standard, because minutes nobody
has seen are decisions nobody can rely on.

**Breach in the data.** A meeting held more than thirty days ago whose `minutes_sent_on` is empty.

**Command.** `compliance minutes`. `meeting minutes <id> --on=` records the send, only once it has
actually happened.

---

## The Australian equivalents, at a high level

If the business manages schemes in Australia, rebuild this file on the state act and keep the
shape: one rule, one source, one query, one command.

- **New South Wales.** Strata Schemes Management Act 2015: the AGM cycle, the capital works fund
  and its ten year plan (s 80), insurance at replacement value with a valuation at least every five
  years (ss 160 to 162), levy recovery and interest (s 85), and the strata information certificate
  (s 184) playing the role the disclosure statement plays here.
- **Queensland.** Body Corporate and Community Management Act 1997 and the regulation modules: the
  AGM within three months of the end of the financial year, the sinking fund forecast, insurance
  under the modules, and the body corporate information certificate.
- **Victoria.** Owners Corporations Act 2006: the AGM, the maintenance plan and fund for
  prescribed owners corporations, insurance, and the owners corporation certificate (s 151).

The `/customise` command is the intended way to make that change: describe the jurisdiction, and
the rules, the ladder and the documents change together.
