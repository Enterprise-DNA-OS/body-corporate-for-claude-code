---
description: Draft the note that goes to a chairperson or a committee, from their scheme's own position. Into drafts/, never sent from here.
---

The operator names a scheme and roughly what the note is for ("update the chair on the roof", "monthly note to the Millhouse committee").

1. Read the scheme first: `npm run strata -- scheme <code> --json`. The arrears, the maintenance and where each item actually is, the insurance position, the meeting record and the compliance register.
2. Write it the way a good manager writes to a volunteer chairperson:
   - What has happened since the last note, in plain sentences with dates.
   - What is waiting on the committee, each with the quote and the delegated limit context, so the ask is one decision, not a puzzle.
   - What is coming: the AGM deadline, an insurance renewal, a levy run falling due.
   - Money last: arrears in one line, spend against anything they have approved.
3. Never soften a finding. An expired BWoF or an uninsured day is stated plainly with the fix in the same sentence.
4. Never promise a date a contractor has not given. Never state a legal position that is not in docs/compliance.md with its section.
5. Save to `drafts/<scheme>-committee-update-<date>.md` and stop. A person reads it, edits it, sends it, and logs it: `note "<scheme>" "sent the committee update" --kind=email`.
