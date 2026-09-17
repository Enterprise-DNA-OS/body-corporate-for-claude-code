---
description: The levy position across every scheme. What has been struck, what has fallen due, what is outstanding, and the run that funds the year.
---

1. Run `npm run strata -- levies [--scheme=]`.
2. Lead with the one number: total outstanding on levies that have fallen due, and which schemes carry it.
3. Runs that have fallen due and are not fully collected point at the arrears list: `/arrears` names the lots.
4. Future runs are position, not a problem. Say when the next one falls due per scheme.

Striking a new run:
- `levy strike <scheme> --fund=operating|maintenance --total=16800 --due=YYYY-MM-DD [--name=]`
- The total splits across the lots by utility interest, the way the plan says it must.
- A levy is struck by resolution. If there is no motion on a meeting behind it, say so and record one first.
- Render the notices with `npm run docs -- levy-notice`; a person sends them.

Receipts:
- `levy paid <lot> --amount= [--on=] [--reference=]` records what came in.
- The ledger is a record. The money itself lands in the body corporate's own bank account, and the bank account stays in the system that holds it. Never present this ledger as a bank balance.
