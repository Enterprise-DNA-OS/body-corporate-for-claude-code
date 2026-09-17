---
description: The small entries that keep the record true. A call logged, a levy receipt, an arrears step, a task added or done.
---

Map what the operator says to the right recording command, run it, and confirm in one line.

| They say | Run |
|---|---|
| "I rang the chair about X" | `note "<scheme>" "<what was said>" --kind=call` |
| "Spoke to the owner of HVA-07" | `note "HVA-07" "<what was said>" --kind=call` |
| "$901 came in from Bracewell" | `levy paid KEL-09 --amount=901` |
| "The reminder went out" | `arrears-log <lot> "reminder"` |
| "It has gone to the debt collector" | `arrears-log <lot> "debt recovery"` |
| "Chase X next week" | `task add "<what>" --scheme= --due=` |
| "That is done" | `task done <id>` |

Rules:
- Log against the most specific record: a lot beats a scheme, a scheme beats nothing.
- Log the conversation the day it happens. A contact log with gaps is what a complaint looks like from the inside.
- Money entries are records of what the bank account did, not bank transactions. If the operator wants to move money, that happens in the system that holds the account.
