---
description: The insurance programme across every scheme. Expiry, the valuation the sum insured rests on, premiums, and the two failure modes: an expired policy and a stale valuation.
---

1. Run `npm run strata -- insurance [--scheme=] [--expired]`.
2. Two findings outrank everything else and go first:
   - **An expired principal policy.** That is an uninsured building. The Act requires principal insurance at all times (Unit Titles Act 2010 s 135). Ring the broker today.
   - **A missing or stale valuation.** Full replacement value is only as real as the valuation behind it. Over three years old, the sum insured is a guess.
3. Then policies expiring inside thirty days with no renewal recorded, with the premium so the committee is not surprised.
4. Record the facts as they land:
   - `insurance renew <policy> --expires= [--premium=] [--sum=]` when the renewal confirms
   - `insurance valuation <scheme> --amount= [--on=]` when a new valuation arrives. If the sum insured is under it, the output says so; that line goes to the broker the same day
   - `add policy --scheme= --kind=principal|liability|"office bearers" ...` for a new policy

Premiums and sums insured come from documents, never from memory. If a figure is not on file, say which one is missing.
