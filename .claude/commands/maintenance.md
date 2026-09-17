---
description: Common property maintenance: raise it, put it to the committee, approve it with a resolution reference, get it done. Habitability first, always.
---

The list:
1. `npm run strata -- maintenance [--urgent] [--scheme=] [--all]`
2. Habitability items (water into a unit, the lift out, the fire system down) lead every answer, with days open.
3. Then whatever has been sitting on a committee longest, with the scheme and the chair named. A committee that has not answered in a week gets a nudge drafted, not a longer wait.
4. Then approved work nobody has sent a contractor to. That one is on us, not the committee.

The lifecycle:
- `maintenance new <scheme> "<what>" [--priority=] [--category=] [--lot=] [--habitability]` raises it
- `maintenance ask <ref> --quote=` puts it to the committee. Over the delegated limit, say so: it needs a resolution, not a nod
- `maintenance approve <ref> --ref="Flying minute 2026-XX"` records the decision WITH its reference
- `maintenance decline <ref> "<why>"` records a no
- `job issue <ref> "<contractor>" --quote=` sends someone. It refuses until the approval is on file; `--force` is for genuine emergencies under the manager's delegated authority, and the reason goes in `--note`
- `job book|done|invoice|cancel` moves the job. `job done <no> --complete` closes the request too
- `maintenance complete <ref>` closes it

Never mark an approval the committee has not given. An approval is evidence of a decision. Never tell an owner a date a contractor has not given you.
