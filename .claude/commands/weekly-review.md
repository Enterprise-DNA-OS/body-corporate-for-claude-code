---
description: The Monday review, written from three commands. Arrears, the AGM season, the insurance programme, the buildings and the five things that matter this week.
---

Run these three, in this order, and write the review from what they return. Do not write anything they do not support.

```
npm run strata -- arrears
npm run strata -- attention
npm run strata -- meetings-due
```

Then write it in this shape, no more than a page:

1. **The week in one line.** Total arrears, how many lots are past sixty days, how many schemes are against or past their AGM deadline, and whether any building is uninsured.
2. **Levies.** Arrears worst first, each with the rung of the ladder it is missing. Name anything at ninety days where recovery has not started: that is the line a principal reads first.
3. **The AGM season.** Every scheme against the six month deadline (UTA 2010 s 89): held, booked, or exposed. Any meeting whose notice went out short of fourteen days gets named, because it may need to re-issue.
4. **Insurance.** Anything expired, anything expiring inside thirty days with no renewal recorded, and any sum insured resting on a valuation over three years old. One line each with the dollar exposure.
5. **The buildings.** Habitability work open, anything sitting on a committee for more than a week with the scheme named, anything approved that nobody has actioned, and finished work with no invoice.
6. **Sales and disclosures.** Open disclosure requests against the five working day clock, oldest first.
7. **Compliance.** BWoFs, LTMP reviews, audits, asbestos registers. One count each and the worst one named.
8. **The five things to do this week.** Pick them yourself from the attention list, weighted by risk first and money second, and say why each one made the list.
9. **One thing to decide.** The single item that needs a person, not a process.

Add `npm run view -- week` and `npm run view -- portfolio` if the operator wants pages to send on. They render the same numbers in the business's brand, and they print.

Numbers come from the commands. If a number is not in the output, it does not go in the review.
