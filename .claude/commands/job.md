---
description: The contractor jobs: issue, book, finish, invoice. And the finished work nobody has invoiced, which is next month's account surprise.
---

1. `npm run strata -- jobs [--all]` lists everything open or not yet invoiced. `job <no>` shows one with its maintenance request.
2. `job issue <maintenance> "<contractor>" --quote=` engages someone. It refuses while committee approval is outstanding; that refusal is the system working, not an obstacle. `--force` exists for emergencies only, with the reason in `--note`.
3. `job book <no> --on=` sets the date. Tell residents if access is affected.
4. `job done <no> [--complete]` when the work is finished. `job invoice <no> --amount= --ref=` when the invoice lands; more than ten percent over the quote gets called out.
5. Finished work with no invoice after a fortnight shows on `/attention`. Chase the contractor, or the body corporate's accounts get a surprise at year end.

`contractors` lists the trades with licences, insurance expiry and twelve month spend. A contractor with expired liability insurance does not get issued new work; say so.
