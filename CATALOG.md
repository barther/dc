# Catalogs: destinations, compilation, confidence

Two problems that turn out to be one:

1. **Destination selection** must be dynamic — any city, plus write-ins — or the
   destination bracket is a menu of two.
2. **Content generation** must produce the scheduler's semantic model, not a
   list of attractions, or the planner has nothing to plan with.

The connection: a destination bracket does not need a catalog. It needs a
shallow record. Compilation is what happens *after* a destination wins. That is
what makes arbitrary destinations affordable.

---

## 1. Two tiers, two speeds

| | Destination record | Catalog |
| --- | --- | --- |
| Answers | "Should we go here?" | "What do we do here?" |
| Size | ~20 fields | 60–120 venues × ~18 fields, plus bundles |
| Cost | Cents, seconds | Dollars, minutes |
| Made | On demand, including write-ins | Lazily, on demand signal |
| Wrong is | A bad bracket matchup | A ruined Tuesday |

### The destination record

```
id, name, region, centroid, timezone
base            where a group would plausibly stay (anchors geo.base)
climate[month]  categorical: rain/cold/wind/heat likelihood, from climate
                normals — not forecast; the trip may be a year out
daylight[month] computed from latitude; "Prague in December has 8 hours"
                is a scheduling fact, not trivia
breadth         count of candidate experiences above a popularity floor,
                bucketed: enough for 3 nights / 7 / 12+
intent[]        light tags for the vibe filter
catalog_state   none | generated | reviewed | verified
```

**Travel legs are not on this record.** Reachability is a function of
`(origin, destination, dates, accepted modes)` and belongs to the trip, not the
destination. For a party that won't fly, this filter alone cuts the world to
dozens before anything else runs.

### Building the bracket field

You cannot bracket five thousand cities. Funnel to sixteen:

1. **Reachability** — within the party's travel tolerance, in modes they accept.
2. **Season** — destination climate for the window. Reject the beach town in
   February; flag, don't reject, the eight-hour daylight.
3. **Breadth** — enough material for the duration range under discussion.
4. **Intent** — the group's stated vibe, held loosely.
5. **Rank and seed** the survivors, take sixteen.
6. **Write-ins, always.** Someone's sister lives in Denver. A write-in triggers
   on-demand record creation and enters as an unseeded contender.

### Solving the latency cliff

A bracket ends and the winner has no catalog. Don't build a spinner for it:
by the semifinals only four contenders remain, and a family bracket takes days
to fill across four people. **Speculatively compile the final four.** By the
time the last game is decided, the winner is already built, and three wasted
compilations cost less than one bad first impression.

---

## 2. What actually has to be generated

Classifying every field on a venue record changes the size of the problem.

### Retrieved — fetch, never infer; has an expiry

| Field | Source | Staleness |
| --- | --- | --- |
| `ll`, `name` | Places API, Wikidata | Years |
| `reservation` | Official site, Places | **Weeks** — the field most likely to be silently wrong |
| `constraints.weekdays` | Official hours | Months |
| `constraints.holidays` | Official calendar | Annual |
| admission, ticket URL | Official site | Weeks |

Every retrieved field carries `source` and `fetched_at`. A catalog with stale
reservation data produces a family standing outside a building that needed
timed entry, which is the specific failure that ends trust in the product.

### Derived — pure computation, no model involved

`miles`, `go` (walk vs ride, from distance and transit availability), bundle
proximity clusters, contender seeding order, daylight-constrained `period`
candidates.

### Judgment — the actual problem, and it is five fields

```
load          lo | mid | hi
ideal_hours   the full visit
min_hours     the shortened visit
shortenable   whether min_hours is still a real visit
seed          how badly we'd regret missing it
```

Three observations that shrink this further:

- **`weather` is mostly derivable.** Your own catalog proves it — `INDOOR_ALL`
  and `MEMORIAL` are shared constants because fit is a function of environment
  plus exposure. Generate `environment` and an exposure flag (sheltered / walk-up
  / walking-between-points), derive the four weather values from a small table,
  allow judgment to override with a reason.
- **`load` mostly falls out of `ideal_hours` + exposure + terrain.** Get duration
  and exposure right and load is a formula with a correction, not an independent
  guess.
- **`seed` is the bracket's job.** It ranks regret, which is group-specific.
  DC needed authored seeds because it shipped before ballots existed. A generated
  catalog can seed weakly from popularity and let `familyOrder` produce the real
  ranking. Same for `identity`: the group's champions *are* the trip's identity.

**What's irreducibly hard: how long does this take, and is the short version
still a real visit.** That's it. That's the compilation problem.

---

## 3. How to generate the judgment fields

### Compile by comparison, not by absolute scale

Do not ask for a rating. Ask for placement against anchors that are already
calibrated. The DC catalog is a ruler:

```
lo   National Archives      2.5h  indoor, sheltered, shortenable
mid  White House exterior    1h   outdoor walk-up, brief
hi   Arlington               5h   outdoor, hills, continuous walking
hi   Natural History         5h   indoor but exhausting; crowd load
hi   Capitol                 4h   mixed, timed entry, guided pace
hi   The memorial loop       2h   night, four stops, walking between
```

The prompt shape is pairwise and forced:

> Prague Castle. Against these anchors, is a full visit longer or shorter than
> Arlington National Cemetery? More or less physically demanding than the
> memorial loop? If a group had only 90 minutes, is that still a real visit, or
> is it a photo stop that will feel like a waste?

Comparative judgment is substantially more reliable than absolute judgment, and
it inherits your calibration rather than inventing its own.

### Disagreement is the confidence score

Run each judgment three times against different anchor subsets. Agreement means
confident. Spread means the model doesn't know, which is the signal you actually
want. Then:

- **Resolve pessimistically.** Higher load, longer minimum, `shortenable: false`,
  worse weather fit, harder reservation. Under-promising degrades to a pleasant
  surprise. Over-promising degrades to an exhausted family.
- **Flag for review** only where spread is wide. Human attention goes to the
  disputed 15%, not to all of it.
- **Record the derivation** per field: `generated` | `sourced` | `reviewed` |
  `observed`.

### Bundles

Hardest part, because bundles encode geographic, thematic, *and* temporal
coupling. Two passes:

1. **Derive candidates** — cluster by distance, filter to a single `period`, drop
   clusters whose summed `ideal_hours` won't fit a slot.
2. **Judge coherence** — is this a thing a group would actually do as one
   outing, or four dots that happen to be near each other? Name it. Decide core
   vs accessory: what breaks if it's missing versus what's a bonus. `together`
   is the assertion that splitting them is worse than dropping them.

Bundles are where a generated catalog most visibly reads as generated. Low
confidence here should collapse to no bundle rather than a bad one — unbundled
venues schedule fine; a wrong bundle drags a good thing down with a bad one.

### Prose is not part of this

Your catalog's voice — *"Nothing to accomplish tonight except finding the bunks
and watching Alabama slide by in the dark"* — does not survive generation at
scale, and imitating it badly is worse than not having it. Separate the
**semantic model** (what the scheduler needs) from **prose** (what the pages
render). Generate the model. Give generated cities plain, factual copy and let
voice be a privilege of curation. A verified city reads like it was written by a
person because it was.

---

## 4. The admission gate: the planner validates the catalog

Your architecture already says the planner decides whether a state is valid.
Extend that to catalogs. A compiled catalog is not usable until it passes:

**Structural**
- Coordinates present and within a sane radius of `base`
- Hours and closure rules parse; holiday keys known
- Seeds unique and dense; `bracket.contenders()` yields ≥ 16
- No bundle mixing periods; no bundle whose members exceed a slot
- Weather table complete for every venue

**Behavioral — run the real planner**
- `plan()` succeeds for every night count from `MIN_NIGHTS` to `MAX_NIGHTS`
- No plan places HI+HI in a day
- Headline counts land inside a sane band, so the catalog is neither too thin to
  fill a week nor so dense that everything gets cut
- `suggestSwap()` under a synthetic bad forecast produces a legal alternative
- No venue is unschedulable at every length — an experience that can never be
  placed is a catalog bug, not a scheduling outcome

This is the same test discipline as `test/planner.test.js`, pointed at the
catalog instead of the scheduler. **A catalog the planner can't build humane
weeks out of never ships**, regardless of how good the JSON looks.

---

## 5. The correction loop

Live mode already records what nobody else collects:

| Signal | Corrects |
| --- | --- |
| `completed` date vs the placed slot | `ideal_hours` |
| `bail` on a venue | `load` up, `shortenable` down |
| `not_this_day` after a forecast | `weather` fit |
| Swap accepted or ignored | Whether the fit model matches lived experience |
| Punted after being ranked highly | Catalog description oversold it |

Generation supplies the prior. Trips supply the evidence. A field moves from
`generated` to `observed` once enough independent groups agree, and confidence
rises with it.

Two cautions. One family is a sample of one — noisy, and biased toward that
family's capacity, so observations must be normalized against the group's own
pace policy before they update a global prior. And the loop only compounds if
it's *collecting*: every bail and shortening should be written as a **catalog
observation**, distinct from the trip event, starting before there's anyone to
learn from. That's cheap now and unrecoverable later.

This is the moat. Catalogs are copyable. A record of where real groups actually
ran out of energy is not, and it exists only because this product models load at
all.

---

## 6. Rough economics

Per city: 60–120 candidates, a handful of retrieval calls each, five judgment
fields at three samples each. Order of a few hundred model calls and a few
hundred place lookups. **Dollars per city, not hundreds.** Compilation cost is
not the constraint.

Human review is the constraint, and the confidence layer is what keeps it
bounded: review the flagged minority, not the whole catalog. A city that never
gets reviewed still works — it just says so.

Three tiers, surfaced honestly in the product:

- **Verified** — reviewed by a person, corrected by trips. Full voice.
- **Sourced** — retrieved facts current, judgment generated with high agreement.
- **Estimated** — generated, low agreement, pessimistic defaults. Say so in the
  schedule: *"Pacing here is estimated. We've guessed heavy."*

---

## 7. Where this breaks

Named so they're decisions rather than surprises.

- **Reservation data is the sharp edge.** It changes without notice and its
  failure mode is a family locked out of a building. Refresh aggressively, and
  treat "unknown" as `recommended`, never `none`.
- **Seasonal catalogs.** A Christmas market is a venue for five weeks a year.
  Venues need validity windows, or generated catalogs will confidently schedule
  things that don't exist in April.
- **Non-US weather.** `weather.js` is NWS. Every other country needs a different
  source with a different shape reduced to the same categorical model.
- **Transit.** `go` is walk-or-ride with a distance threshold. That holds in a
  dense walkable core and breaks in a city where the answer is a 40-minute bus.
  Geographic cost may need to become a real travel-time matrix before the
  scheduler's geography reasoning transfers.
- **Popularity is not regret.** Seeding from visit counts ranks tourist volume,
  which is a different quantity from what a family would be sad to have missed.
  Acceptable only because the bracket overrides it — which is an argument for
  never letting the seed leak into the product's own recommendations.
