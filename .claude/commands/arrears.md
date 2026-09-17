---
description: Who is behind on their levies, how far, and the next rung of the ladder. The number a body corporate manager is judged on.
---

The operator wants the arrears list. Arguments might be a number of days ("60"), a scheme ("HVA"), or nothing at all.

1. Run `npm run strata -- arrears [--min-days=] [--scheme=]`.
2. Lead with two numbers: the total owing, and how many lots are past sixty days. Those are the ones a committee asks about.
3. Work down the list worst first, and for each one say the rung of the ladder the file is missing:
   - **Ninety days or more.** If recovery has never been started, that is today's job. The file already supports it: reminder, demand, dates.
   - **Sixty days or more.** The formal demand. It is the letter that changes behaviour, and the one an adjudicator looks for.
   - **Thirty days or more.** The reminder. Most arrears end here.
   - **Under thirty days.** A phone call. Not a letter.
4. Name the owner and the scheme in every line. An arrears list without a name in it does not get actioned.
5. Say plainly where a payment plan is running, and whether it is being kept.
6. If interest is being charged, remember the cap: ten percent a year (Unit Titles Regulations 2011). Never invent an interest figure.
7. End with the two or three to deal with today, and one line each on why.

Record what happens next:
- `arrears-log <lot> "reminder"` after one goes out
- `arrears-log <lot> "formal demand"`
- `arrears-log <lot> "payment plan" --note="$200 a fortnight until square"`
- `arrears-log <lot> "debt recovery"` when it goes to the collector
- `levy paid <lot> --amount=` when money comes in
- `/draft-arrears-letter <lot>` for the letter, saved to `drafts/`

Never send anything from here. This system records the steps; a person sends the letters and keeps the proof.
