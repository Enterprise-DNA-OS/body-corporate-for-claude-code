---
description: The disclosure clock on every sale in every scheme. A pre-settlement statement has five working days (UTA 2010 s 147); this is the list of clocks running.
---

1. Run `npm run strata -- disclosures` (add `--all` for the history).
2. Anything past five working days is late in a way that can hold up someone's settlement. It goes first, with the conveyancer named.
3. When a request arrives: `disclosure request <lot> --kind=pre-contract|pre-settlement --by="<who asked>"`. The output states the statutory due date; diary it.
4. Building the statement is reading this database out loud: the lot's levy position (`lot <ref>`), any unpaid levies, the scheme's insurance, any special levy struck or proposed, and open remediation. Draft it to `drafts/`, a person checks and sends it.
5. When it goes out: `disclosure provide <lot> --on=`. If it went out late, the output says so; note why on the file.

Never guess a levy balance for a disclosure. The statement is a legal document; every number on it comes from the ledger.
