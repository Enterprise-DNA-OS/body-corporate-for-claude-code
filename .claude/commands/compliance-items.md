---
description: The per-scheme compliance register: LTMP review, insurance valuation, building warrant of fitness, audit, fire evacuation scheme, asbestos register, pool barrier. Each with its status and its source.
---

1. Run `npm run strata -- compliance-items [--scheme=] [--all]`.
2. "Not compliant" beats "unknown" beats "due soon". Work in that order.
3. An "unknown" is not a pass. It means nobody has looked, and the answer is to book the assessment, not to relabel it.
4. Close one out only when the evidence exists: `compliance-item done <scheme> "<item>" --evidence=<certificate or invoice ref> [--due=<next renewal>]`. Closing the BWoF or the LTMP review also moves the scheme record the `/compliance` rules read.
5. `compliance-item fail` and `compliance-item exempt` record the other two honest answers. An exemption carries a reason in `--note`.

Every item names the rule it comes from (the Act, the Building Act, FENZ, the asbestos regulations). If an item's rule looks out of date, check `docs/compliance.md` and fix the doc and the item together.
