---
description: Bring the portfolio across from StrataMax, PropertyIQ, Strata Master or a plain CSV. Dry run first, always.
---

1. The operator has exports from the old system. Two files matter: the building list and the roll (lots with owners). Column names vary; the importer accepts the common ones for each system and matches case-insensitively. See docs/replace-stratamax.md for exactly what to export.
2. Dry run first, every time:
   ```
   npm run strata -- import stratamax --schemes=schemes.csv --lots=lots.csv --dry-run
   ```
   Read the skip list back to the operator. The usual cause is a lot whose building name does not match the building file.
3. Then the real run without `--dry-run`. `propertyiq`, `strata-master` and `csv` work the same way.
4. What comes across: schemes, lots with their unit entitlement as the utility interest, owners with their contact details. What does not: the levy ledger and the bank account (they stay in the old system until the changeover date), minutes as documents, insurance policy files. Say this out loud before anyone deletes anything.
5. Immediately after an import, the machinery needs facts the export never carries. Walk the operator through, per scheme:
   - `add policy --scheme= --kind=principal ...` and the FY end, spend limit and agreement dates on the scheme record
   - the seven compliance items, created as "unknown" on purpose: assess them (`compliance-items --scheme= --all`)
   - the first levy run: `levy strike` from the current year's resolution
6. Check the shape: `stats`, `schemes`, `lots --scheme=<one of them>`. The lot count per scheme should match the old system's roll exactly.
