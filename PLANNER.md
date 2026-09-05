# DC Trip Planner — doctrine

This is the product spec the planner in `public/planner.js` implements. It defines the planning
philosophy and UX behavior, not the implementation.

## Purpose

Turn the fixed Washington trip page into a live family trip configurator. The page still opens as
a confident, concrete proposal, not a blank planning tool. The seven-night itinerary remains the
default and recommended version. The planner exists so someone can ask *"does it have to be seven
nights?"* and immediately see what changing the length actually costs. The goal is to preserve the
spirit, pacing, and hierarchy of this specific trip while allowing the family to shorten or
lengthen it.

## Core trip model

Three kinds of time:

- **Outbound train day.** Mostly lost to travel. The train itself is part of the experience.
- **Washington days/nights.** These contain the actual itinerary. N nights gives N−1 full days.
- **Return train day.** Partially usable before the evening Crescent; never a full sightseeing day.

Controls: arrival date, number of hotel nights, `−`/`+` around the recommendation.
Default: Nov 29 – Dec 6, 2026, 7 nights, Recommended. Never start with empty fields.

## Planning philosophy

Optimize for experience quality, not attraction count. One big thing a day. A hard daytime outing
gets an easy night; a light daytime outing can support a bigger evening. Hierarchy:

1. Preserve the identity of the trip.
2. Preserve reasonable pacing.
3. Preserve the most important experiences.
4. Only then maximize attraction count.

The identity, no matter how short: **Washington, for Christmas.** Heavily protect the civic core,
the founding documents, the memorial night, the Christmas-in-Washington element, and at least one
major Smithsonian. If the trip gets too short for that identity, say so.

## Atomic bundles

- **Capitol Hill:** U.S. Capitol + Library of Congress. One day, never split.
- **Founding documents + memorial night:** Archives by day; Vietnam, WWII, Lincoln, Korea by
  night. The memorials are one experience; never optimize them individually.
- **Christmas Washington:** White House exterior, the Ellipse, the National Christmas Tree, downtown
  atmosphere. The daytime market/shopping is compressible and goes before the evening does.
- **Arrival night:** the Capitol illuminated. No tour, no commitment. The opening scene.
- **Departure day:** a shortened indoor museum, lunch, luggage, Union Station. Never a physically
  demanding attraction. American History is the natural fit in the full-length trip.

## Priority doctrine

- **Protected core:** Capitol, Library of Congress, Archives, Lincoln, Vietnam, Korea, WWII,
  White House / Christmas Washington.
- **Very high:** Air & Space, Arlington.
- **First cuts, in order:** American History, Natural History, Arlington.

## The ladder

| Nights | Label | Kept | What gives |
|---|---|---|---|
| 7 | Recommended | 13/13 | Nothing. Best pacing. |
| 6 | Compressed full trip | 13/13 | Christmas daytime block; Christmas night rides an indoor museum day. |
| 5 | First real cut | 12/13 | American History. Natural History shortens onto the last morning. |
| 4 | Highlights version | 11/13 | American History, Natural History. Air & Space shortens onto the last morning; Arlington keeps its day. |
| 3 | Minimum recommended | 10/13 | American History, Natural History, Arlington. Civic core, memorials, Air & Space, Christmas survive. |
| 1–2 | A different kind of trip | — | The page offers conceptual priorities (monuments & government, museums & family, Christmas Washington) instead of a mangled schedule. |
| 8–9 | Extended | 13/13 | Open days for the bonus round or for nothing at all. |

**Implementation note.** The spec's cut order (American History first) frees no full day, since
American History already lives on the departure day. The rule that reproduces the ladder exactly
is: full days go to the protected bundles, then Christmas only if everyone else still fits, then
Arlington (which can't be shortened), then Air & Space, then Natural History; the departure
morning hosts the highest-priority indoor museum that lost its full day, shortened. At 4 and 3
nights that puts a couple of hours of Air & Space on the last morning, which is the one place the
"nothing demanding on departure day" rule bends, and the spec's own 3-night rung requires it.

## Pacing

Think in physical effort and weather exposure. A day's effort plus its night's effort over 6, or
exposure over 4, is penalized. Arlington all day then the memorial loop is bad; Archives by day
then the memorial loop is good. After a full museum day, prefer dinner and nothing. Do not fill
empty nights merely because space exists. Whitespace is part of the itinerary.

## Calendar

Changing the start date changes every date and weekday label on the page. Modules carry
preferred weekdays (Christmas prefers Saturday, but Christmas evening matters more than Saturday),
closures (Capitol and Library closed Sundays and federal holidays; Smithsonians closed Christmas
Day; Archives closed Thanksgiving and Christmas), a preferred relative position, intensity, and
exposure. Normal users never see this machinery; they see a sensible itinerary. The planner never
promises the National Christmas Tree is lit unless that is known.

## UX

Persuasive first, configurable second. The initial state is the polished trip page. "Change the
trip" near the countdown expands to arrival date, nights, `−`/`+`. The itinerary updates
immediately; there is no "Generate" button. Whenever the length changes, show the consequence:
nights, label, headline count, what was cut, and why. The count is useful; the explanation matters
more.

## Copy

Confident, warm, mildly funny, not corporate, not apologetic about making choices. When something
is cut, say so plainly. Shorter versions are tradeoffs, not "worse". The House Rules govern every
generated itinerary.

## Not this

Not a generic tourism planner, not a freeform AI itinerary generator, not a drag-and-drop
spreadsheet, not a preference questionnaire, not an attraction-count optimizer, not a booking
engine, not a map dashboard. This is still our trip. The planner answers one question: *what does
our trip look like if we change the dates or make it shorter?*


---

# Version two: Build Your Trip

The planner is now an opinionated scheduler over a venue catalog rather than a table of
night-count rules. The governing sentence: **build an opinionated scheduler that protects the
best Washington experiences and the family's energy, then lets the user overrule it without
breaking the trip.** For every placement the order of questions is: is it important, does it
fit, does the day stay humane, is there a better day, and if something has to lose, what should
lose.

## Data is the source of truth

`public/venues.js` holds every experience with seed (how badly we'd regret missing it), priority
tier, period, LO/MID/HI load, environment, min and ideal hours, shortenable, reservation,
weather fit, closures, and bundle. Bundles (Capitol Hill, the memorial loop, Christmas
Washington, the Tidal Basin loop) carry bundle-level load and move together. The Archives and
the memorial loop are a same-day pairing. The holiday market is an accessory of Christmas
Washington: it rides along when the slot is free and yields to anything that matters.

## Capacity and the doctrine of a day

Each day has a day slot and a night slot. Arrival day is structural (arrive, hotel, the Capitol
illuminated) and never spare capacity. Departure day is a partial morning: a LO activity or a
shortened indoor visit, never Arlington or a full outdoor day, and it doubles as the release
valve when a higher-value experience needs a full day. Pairings: HI+LO, MID+MID, MID+LO and
LO+LO are preferred; HI+MID is avoided and only the thirteen headline experiences are allowed
to create one; HI+HI is forbidden. Empty time is valid. Bonus-tier venues stay on the bench
until asked for.

## How a plan is built

1. Build units from the catalog and the user's state (punts remove venues; pins go first).
2. Place by value, highest first, into the best-scoring slot. Score = pacing (avoid −8, two
   outdoor outings −3), shortening (−4), a preferred weekday (+3), the Archives/memorials pairing
   (+6), stability against the previous plan (+5), and a small tiebreak toward the recommended
   order of the week.
3. Local search: swap two same-slot placements when the week gets better for it.
4. Release valve: a shortenable indoor visit moves to the last morning so a more important
   full-day experience keeps a full day, when the trade is worth it.
5. Explain the tradeoffs: shared big days, shortened visits, cuts of headline experiences,
   closures, pins that couldn't be honored, and what a pin displaced.

## Labels are derived

The identity test asks whether the civic core, the founding documents, the memorial night,
Christmas Washington, and a major Smithsonian all survived. A protected experience lost to a
closure gives *These dates don't work*. A broken identity gives *A different kind of trip*, which
is also what punting the Capitol earns. A lost high-tier experience gives *Minimum recommended*;
two lost headline museums *Highlights version*; one, *First real cut*; a squeezed day with
everything kept, *Compressed full trip*; punts with the core intact, *Your version*; more than
seven nights, *Extended*; otherwise *Recommended*. The night-count ladder falls out of these
rules rather than being tabulated.

## Not in version one

Weather, live closures, reservations as data, completed-activity tracking, and day-of replanning.
The plan shape and the constraint order already leave room for them: weather will re-rank days,
not attractions; a confirmed reservation will pin a date; completed activities will never move.
