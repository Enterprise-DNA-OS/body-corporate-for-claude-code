---
description: Prepare one scheme's AGM end to end. Book the date against the s 89 deadline, build the agenda from what the year actually needs, render the notice, and diary the fourteen days.
---

The operator names a scheme. Build the whole AGM from the record, not from memory.

1. Read the scheme first: `npm run strata -- scheme <code>`. Note the FY end and the deadline, the levy runs struck this year, the insurance expiry and valuation age, the LTMP review date, open maintenance over the committee's limit, and anything in arrears or non-compliant.
2. Propose a date. It has to sit inside the s 89 deadline with at least fourteen clear days for the notice, and realistically three weeks for the pack. Book it: `meeting schedule <scheme> --kind=AGM --on=`.
3. Build the agenda from what the record says this scheme has to decide, in the usual order:
   - Adopt the financial statements (and the audit position if s 132 applies)
   - Strike the operating levy and the maintenance fund levy for the coming year
   - Insurance: note the renewal, and a motion for a revaluation if the valuation is past three years
   - The long-term maintenance plan: adopt, or resolve the review, if it is due
   - Any maintenance over the committee's delegated limit that is waiting on a resolution
   - Elect the committee and the chairperson
   - Renew the management agreement if it expires this year
   Add each one: `motion add <meeting> "<title>" [--kind=special]`. A special levy or a change to the LTMP fund is a special resolution and needs seventy five percent.
4. Render the notice: `npm run docs -- meeting-notice`. It carries the agenda and the notice position. A person sends it.
5. Record the notice date the day it goes out: `meeting notice <id> --on=`. Diary the meeting.
6. After the meeting: `meeting held <id> --quorum`, one `motion result` per motion with the votes, `levy strike` for the levies the meeting resolved, and `meeting minutes <id>` only when the minutes have actually gone to owners.

Never invent an agenda item, a levy figure or a vote. Everything comes from the record or from the operator.
