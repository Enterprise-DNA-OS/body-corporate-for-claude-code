---
description: The committees: who chairs each scheme, who sits, and the delegated spending limits the approvals run under.
---

1. Run `npm run strata -- committee [scheme]`.
2. A scheme with no chairperson on file is a finding: name it.
3. The committee's delegated spend limit lives on the scheme (`scheme <code>` shows it). Work over the limit needs a resolution before a contractor is engaged, and `/job` will refuse to issue until the approval is recorded.
4. Changes: `committee add --scheme= --owner= --role=chairperson|committee member` after an election, `committee remove --scheme= --owner=` when someone stands down. Record the meeting that decided it in the contact log.
