# Moving off StrataMax

StrataMax is the strata management platform a large share of Australian and New Zealand management
businesses run on. PropertyIQ and Strata Master are the other two you meet, and the process is the
same. This page is the switch, step by step: what to export, what one command does with it, what
maps, and what does not come across.

Read the last section before you commit to anything. The honest answer is that a management
business cannot leave its trust accounting behind on a whim, and this system is not trying to take
it.

## Before you start

**The money stays where it is.** Levy receipting, creditor payments, the bank reconciliation and
the audit file stay in StrataMax, or in whatever accounting system you move them to. Body Corporate
for Claude Code holds the management lifecycle: the roll, the committees, the levy record and the
arrears ladder, the meetings, the maintenance, the insurance programme, the disclosure clocks and
the compliance register. Run the two side by side for a full month before you decide anything.

**Take a copy of everything first.** Export every report StrataMax will give you, not just the two
below. Once you are off the platform you cannot go back for the ones you forgot.

## Step 1: export

Two exports matter, and every strata platform has them under some name:

| What | Usually called | Save as |
|---|---|---|
| The buildings | Building list, portfolio report, body corporate list | `schemes.csv` |
| The roll | Roll report, owner list, lot schedule | `lots.csv` |

If a report only prints, print it to CSV or Excel and save the sheet as CSV. The importer matches
column names case-insensitively and accepts several names for the same field, so you do not have to
rename anything first.

**Schemes.** Building Name (or Body Corporate Name), Plan Number, Address, Suburb.

**Lots.** Building Name, Lot Number, Unit Number, Unit Entitlement (or Contribution Entitlement /
Utility Interest), Owner Name, Email, Phone, Postal Address.

The two files link on the building name or the plan number.

## Step 2: dry run

```bash
npm run strata -- import stratamax --schemes=schemes.csv --lots=lots.csv --dry-run
```

Nothing is written. You get a count of what would be created, what is already here, and every row
it would skip with the reason. Read the skip list. The usual cause is a lot whose building name
does not match the building file exactly.

## Step 3: import

```bash
npm run strata -- import stratamax --schemes=schemes.csv --lots=lots.csv
```

Then check it:

```bash
npm run strata -- stats
npm run strata -- schemes
npm run strata -- lots --scheme=<one of them>
```

The lot count per scheme should match the old system's roll exactly. PropertyIQ and Strata Master
exports go through the same command with `propertyiq` or `strata-master` in place of `stratamax`.
Anything else works with `csv`, which accepts every column name the others use.

## What maps

| StrataMax | Here | Notes |
|---|---|---|
| Building | `schemes` | Name, plan number, address, suburb; a short code is derived for lot refs |
| Lot | `lots` | Lot number, unit label, unit entitlement as `utility_interest` |
| Owner | `owners` and `lot_owners` | Name, email, phone, postal address; an owner of two lots is one owner |

Every scheme that comes across gets its seven compliance items created with status `unknown`: the
LTMP review, the insurance valuation, the building warrant of fitness, the audit, the fire
evacuation scheme, the asbestos register and the pool barrier. That is deliberate. The system will
not tell you a building is compliant because the old one did not say otherwise.

## What does not come across

Be honest with yourself about this list before you switch.

- **The trust accounting.** Receipts, payments, the reconciliation and the audit trail. It stays in
  StrataMax or moves to a real accounting system. Nothing in this repo replaces it, and nothing
  here should.
- **The levy ledger history.** Start the ledger here from the changeover date: strike the current
  year's runs with `levy strike` from the resolutions, and carry any arrears in as an opening
  position agreed with the old ledger. History stays in the old system's reports.
- **Meeting minutes as documents.** The dates and results can be re-keyed for the current year if
  they matter; the documents live in your own file store. Keep read-only access to the old system
  for a year.
- **Insurance policy documents.** Enter each scheme's current policies with `add policy` from the
  schedules; the PDFs stay in your document store.
- **Committee details.** The roll export rarely marks them. Ten minutes per scheme with
  `committee add` fixes it, and it is worth doing first: half the machinery here reports to a
  chairperson.
- **FY ends, spend limits, agreement dates.** Set them on each scheme record; the AGM deadline and
  the approval gate need them.
- **Anything your business built as a custom field.** Add it here with `/customise` and it becomes
  a real column, not a note in a text box.

## Step 4: the first week

1. Set each scheme's `last_fy_end_on`, committee spend limit, management agreement expiry and base
   fee. `/attention` and `/meetings-due` are blind without them.
2. `committee add` the chairs. `add policy` the insurance programme.
3. `levy strike` the current runs from the year's resolutions, and record opening arrears agreed
   with the old ledger.
4. Work through `compliance-items --all` per scheme until nothing says `unknown` that should not.
5. Fill in the "Who this is for" block in `CLAUDE.md` and put your name and colours in
   `brand.json`, then `npm run docs` and `npm run view`.

## Running both for a month

The safe way to switch is not to switch. For one full month:

- Receipt levies and pay creditors in the old system, as you do now.
- Record everything else here: meetings, notices, arrears steps, maintenance, disclosures,
  committee contact.
- At the end of the month, compare the arrears list, the AGM board and the compliance register from
  both, and ask which one told you about the expired policy first.

If the answer is obvious, keep going. If it is not, you have lost a month and gained a clean
compliance register.
