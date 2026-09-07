# The product

**Preference-first group travel planning with constraint-aware, deliberately
non-maximal scheduling.**

Most itinerary tools try to maximize how much itinerary they can produce. This
one tries to maximize how good the trip feels. Free time is a feature. The bench
is a feature. "This place is dumb, let's bounce" is a supported state
transition. Weather changes the plan without invalidating the vacation. The
quietest person's limits survive contact with the loudest person's enthusiasm.

Everything below follows from that sentence. Where a design decision is a
judgment call, the tiebreaker is: does this protect the quality of the trip, or
does it protect the density of the itinerary?

---

## 1. Two kinds of input, two aggregation rules

This is the structural core, and it is the thing most likely to be lost if the
product is built stage by stage without stating it up front.

A group supplies two categorically different things:

**Desire — what we want.** Aggregates by *consensus*. Head-to-head brackets,
mean rank across completed ballots, champions locked to the top, ties broken by
seed. Being outvoted here is legitimate: you wanted the zoo, three people wanted
the Capitol, the Capitol wins. `familyOrder()` already implements this.

**Capacity — what we can take.** Aggregates by *minimum*. Pace tolerance, hours
on feet, consecutive heavy days, mobility, the hour past which a nine-year-old
stops being a person. Being outvoted here is not legitimate. If capacity
averages, the fittest member sets the pace and the product has quietly become
the thing it exists to replace.

Two channels, two rules, and the rules are not interchangeable. Every other
group-planning tool collapses these into one bucket called "preferences," which
is exactly why their output exhausts somebody.

A third input already exists and is neither: **hard edges** — a date somebody
must be home by, a date somebody can't leave before. These aggregate by
*intersection*, and they are already implemented (`trips.constraints`).

| Input | Example | Aggregation | Status |
| --- | --- | --- | --- |
| Desire | "Air & Space over Natural History" | Consensus (mean rank) | Built |
| Capacity | "Two heavy days in a row is too many" | Minimum (floor) | Built: a pace per traveler, the floor is the party's, pace is policy in the planner, and a rest day is anyone's to call |
| Hard edges | "Back by Thursday 2 PM" | Intersection | Built |

---

## 2. The stages

```
Who's going              → party, capacity floors, hard edges
Where could we go        → destination bracket        (desire)
How long                 → duration by consequence    (not a vote)
What matters there       → activity bracket           (desire)
Build the humane version → constraint-aware schedule
Reality                  → weather, closures, reservations
What's the best move today → live replan
```

### Stage 1 — Who's going · **missing**

Not just membership. Membership exists (`trip_members`). What's missing is
capacity intake: each member states what they can take, in their own terms, and
the party's policy is derived as the floor. This is also where hard edges are
collected, which already works.

Design note: capacity intake must not read as a health questionnaire. The
question is "what makes a day too much for you," not "what's wrong with you."
Ask in outcomes — *by dinner I want to be done*, *I can do one big thing a day*,
*I'll go all day and sleep on the train* — and derive the numbers.

### Stage 2 — Where · **missing, and I'd build it last**

A destination bracket over a shallow destination catalog: season fit for the
window, travel time and cost from origin, breadth of what's there, weather
profile. Same bracket machinery, different adapter.

**Sequencing argument:** this is first in the funnel and should be last in the
build. "Where should we go" is the most contested query on the internet, it's
where the product has the least proprietary data, and it's the stage where it
most resembles everything else. Stages 3–7 are where it's alone. Building in
narrative order spends the first year on the weakest surface.

Also note the circularity: destination depends on season, season depends on
dates, dates depend on destination. Resolve it by treating dates as a *range*
here ("late Nov to mid Dec, 5–9 nights") and narrowing at stage 3.

### Stage 3 — How long · **missing, and it is not a bracket**

Ranking machinery doesn't fit a scalar, and asking four people to agree on a
number produces an argument, not a decision.

Better mechanism, using machinery that already exists: run the planner at every
feasible length and show what each additional night *buys*, in the currency the
product cares about — how many of the group's top-ranked experiences clear the
bar, where the hard edges start biting, how many days stay within the capacity
floor, how much slack survives. People choose from consequences instead of
guessing at numbers.

`fitOptions()` already does a one-night version of this ("Add one night," with
its consequence). Generalize it across the range and this stage is mostly
assembly.

### Stage 4 — What matters there · **built**

The activity bracket. One matchup at a time, play-ins past sixteen, a total
order from one completed ballot, the group's order from every completed ballot,
abstention as a first-class state so the week stops waiting on someone who
doesn't care. This is the best part of the product and it is finished.

### Stage 5 — The humane schedule · **built, but the philosophy is hardcoded**

The planner packs the group's order into the days under closures, reservations,
bundle integrity, geography, and load rules, and explains what lost and why.

The problem: the pacing philosophy is expressed as module constants.

```js
const MUST_SEE = 13, FINAL_FOUR = 4;
if (a === "hi" && b === "hi") return -Infinity;   // forbidden
```

`hi + hi → -Infinity` is a travel philosophy written as a law of physics. For a
group of four adults in their twenties it's wrong. For a group with a
seventy-year-old and a nine-year-old, one HI day may already be too many. These
constants are the same class of error as the hardcoded work schedule that was
just removed — one family's parameters mistaken for universal truth — except
this is the instance that matters, because it's the instance that encodes the
product's entire claim.

**Change:** pacing becomes a policy object derived from the capacity floor at
stage 1, passed into the planner the way constraints now are. The scoring rules
read the policy. The default policy is today's constants, so nothing regresses.

### Stage 6 — Reality · **built**

Closures, holiday rules, reservation hardness, NWS forecast reduced to
categorical conditions, per-venue weather fit.

### Stage 7 — Live · **built, and undervalued**

Mark done, bail, not-this-day, and a swap proposed only when the forecast makes
the win real. See §4 — this stage is quietly the most commercially important
thing in the repo.

---

## 3. Where the bracket goes

`bracket.js` is already a general group-preference primitive with one adapter
bolted on. `structure`, `resolve`, `valid`, `ranking`, and `familyOrder` take
`(struct, ids, picks)` and know nothing about venues, catalogs, or travel.
Only `contenders(catalog)` is coupled.

So the move is a split, not a rewrite:

```
bracket/core.js       structure · resolve · valid · ranking · familyOrder
bracket/venues.js     contenders(catalog)        → the activity bracket  (exists)
bracket/places.js     contenders(destinations)   → the destination bracket
```

Ballots are already stored per `(trip, user, game)`. Add the bracket's *subject*
to that key and one trip can hold several brackets — where, then what — without
a second table or a second implementation. `familyOrder` is the consensus
engine for all of them.

---

## 4. Catalogs: discovery, compilation, confidence

The right architecture is one product, not two companies:

**Discovery** finds candidate destinations and experiences broadly.

**Compilation** turns raw place knowledge into the scheduler's semantic model:
load, ideal and minimum hours, whether shortening is still a real visit, weather
sensitivity per condition, closure behavior, bundle relationships, reservation
hardness, geographic cost. This is the layer that matters. Knowing Prague has a
castle is commodity. Knowing the castle is a HI-load four-hour uphill commitment
that shortens badly and fails in rain is the product.

**Confidence** records how each field was derived — generated, sourced,
verified, or corrected by observation — and surfaces it. "Prague: pacing
estimated, not verified" belongs in the schedule, not in an admin table.

### The asymmetry rule

Generated metadata's danger is not gaps. It's being confidently wrong in the
direction that breaks the promise. A generated `load: lo` on a five-hour slog
produces an inhumane schedule that still calls itself humane — worse than no
schedule, because it burns the only differentiator.

So uncertainty resolves pessimistically, always: heavier load, longer minimum,
`shortenable: false`, worse weather fit, harder reservation. Pessimistic
defaults degrade to "we under-promised." Optimistic defaults degrade to "this
app ruined our Tuesday."

### The correction loop is the moat

Live mode already records that a group bailed on something, on which date, after
how long, and marked things complete with dates. That is ground truth on load
and duration that no competitor collects, because no competitor models load in
the first place.

Generated catalogs get corrected by trips people actually took. The compounding
asset is not the catalog — catalogs are copyable. It's the corrections, and they
only exist because stages 5 and 7 exist.

This is also the answer to "curated or generated": neither is the company.
Curation is the cold-start cost. Generation is the coverage strategy. The
correction loop is the business. That determines what to instrument first —
every bail, swap, and shortened visit should be recorded as a *catalog
observation*, not just a trip event, starting now, while the data is still only
one family's.

---

## 5. Minimum architecture changes, in order

1. **Split the bracket into core and adapters.** Small, mechanical, unlocks
   every later stage. Key ballots by bracket subject.
2. **Pacing as policy, not constants.** Extract `MUST_SEE`, `FINAL_FOUR`, and
   the load matrix into a policy object passed into `plan()`. Default to today's
   values.
3. **Capacity intake, aggregating by minimum.** The stage-1 questions and the
   floor derivation that feeds (2). This is the change that makes the philosophy
   structural.
4. **Duration by consequence.** Generalize `fitOptions()` across the length
   range. Mostly assembly.
5. **Catalog as data, with a confidence field per attribute.** Move catalogs out
   of code. Asymmetric defaults. Surface confidence in the schedule.
6. **Catalog observations from live mode.** Every bail, shorten, and swap
   written as evidence against the compiled model. Start now; the loop only
   compounds if it's collecting.
7. **Destination bracket and destination catalog.** Last, per §2.

Deferred, and correctly so: billing, booking links, flight and hotel legs. All
of them are downstream of a planner people trust, and none of them differentiate
anything.

---

## 6. What this product is not

It is not Expedia with more dropdowns. Expedia answers *where can I book a
flight, a hotel, a car*. This answers *given these people, these dates, this
city, this weather, these opening hours, these reservations, and these wildly
different opinions, what trip should we actually take.*

It is not an itinerary generator. Generating an itinerary is the easy part and
the part everyone has. The hard parts are deciding what deserves to be in it,
refusing to fill every hour, and changing the plan on a Tuesday morning without
making anyone feel like the vacation failed.

If a feature makes the itinerary denser without making the trip better, it
belongs to a different product.
