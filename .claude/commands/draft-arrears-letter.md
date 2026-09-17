---
description: Draft the arrears letter for one lot, from the ledger and the ladder, into drafts/. The right rung, the right tone, never sent from here.
---

The operator names a lot. The letter is built from the file, not from a template full of blanks.

1. Read the whole file first: `npm run strata -- lot <ref> --json`. The balance, the levies behind it, the payment history, the ladder so far, and any payment plan.
2. Pick the rung the file says comes next, and write that letter and only that letter:
   - **Reminder (thirty days).** Friendly, factual, assumes an oversight. The balance, the levies it comes from, the payment reference, one sentence inviting contact.
   - **Formal demand (sixty days).** Formal, still civil. The balance, the history of what has been sent, a payment date, what happens next if nothing changes (recovery, and interest if the body corporate charges it, capped at ten percent a year under the Unit Titles Regulations 2011), and the payment plan door left open.
   - **Recovery handover (ninety days).** Not a letter to the owner: a summary for the debt collector or the solicitor. The ledger extract, every dated step, the contact log.
3. Address it to the owner by name. If the lot is owned by a company or a trust, write to the entity, attention the contact on file.
4. Numbers come from the ledger. Do not round, do not estimate, do not add interest that has not been resolved by the body corporate.
5. Save to `drafts/<lot>-<rung>-<date>.md` and stop. A person sends it and then records it: `arrears-log <lot> "<rung>"`.

`npm run docs -- arrears-letter-draft` renders the same facts as a branded HTML sheet if the operator prefers to work from that.
