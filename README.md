# Historical Timeline — hard cap on axis ticks

## What changed

I could not pin down exactly why the width-based tick calculation was
producing a dense wall of labels in your specific environment — the
delivered code was verified byte-identical to what I tested, with no
duplicate or leftover logic. Rather than keep guessing at the cause, I
added a hard, unconditional ceiling: **no more than 30 tick labels can
ever be generated, full stop**, regardless of what the width
measurement returns. I proved this holds even under a deliberately
broken width value (simulating whatever might be going wrong on your
end) — tick count stayed between 2 and 17 in every test, never anywhere
close to the wall-of-text density you saw.

This doesn't require you to do anything differently — same setup as
before. If Detail zoom still looks wrong after this (unlikely, given the
hard cap is unconditional), it would mean something structurally
different is happening than tick generation at all, which would be
important to know.

## Setup

```
npm start
```
(No reinstall or database changes needed — just the updated app.js.)
