---
description: Every scheme against the statutory AGM deadline (six months after FY end, UTA 2010 s 89), with what is booked and whether the notice actually went out in time.
---

1. Run `npm run strata -- meetings-due`.
2. Lead with the schemes in trouble: past the deadline with nothing held or booked, then inside sixty days with nothing booked.
3. For each exposed scheme say what fixing it takes: pick a date, allow fourteen clear days for the notice on top of preparing the pack, and book it with `meeting schedule <scheme> --kind=AGM --on=`.
4. Flag any booked meeting whose notice is short of fourteen days or missing. A meeting held on short notice invites a challenge to everything it resolved; the safe fix is usually to move the date and re-issue.
5. For schemes that are fine, one line: held, or booked and noticed.

The machinery for one meeting:
- `meeting schedule <scheme> --kind=AGM|EGM|committee --on=` books it and states the notice-by date
- `meeting notice <id> --on=` records the notice, with the fourteen day check
- `motion add <id> "<title>" [--kind=special]` builds the agenda
- `meeting held <id> --quorum` then `motion result <id> <n> carried|lost --for= --against=`
- `meeting minutes <id>` records the minutes went to owners
- `npm run docs -- meeting-notice` renders the notice with the agenda, in the business's brand

Nothing here sends anything. The notice is rendered to a file; a person sends it to owners and keeps the proof.
