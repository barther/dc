/*
 * Venue catalog — the planner's source of truth.
 *
 * Planning characteristics live here, not in the HTML or the scheduler.
 * The scheduler consumes these attributes; the UI renders the result.
 *
 *   seed          how badly we'd regret missing it (lower = harder to cut)
 *   priority_tier protected | high | medium | bonus (human category, redundant with seed)
 *   period        day | night
 *   load          lo | mid | hi (how much of the day's battery it eats)
 *   environment   indoor | outdoor | mixed
 *   min_hours / ideal_hours  the shortened vs. full visit
 *   shortenable   whether the min_hours version is a real visit
 *   reservation   none | recommended | required (needing one ≠ having one)
 *   weather       rain / cold / wind / heat fit: poor | acceptable | good | excellent
 *   bundle        which bundle it belongs to, if any
 *   closures      weekdays (0 = Sunday) and holidays it's shut
 *
 * The bundles layer below adds bundle-level load, ordering, and pairings.
 */
(function (root) {
  "use strict";

  const INDOOR_ALL = { rain: "excellent", cold: "excellent", wind: "excellent", heat: "excellent" };
  const MEMORIAL = { rain: "poor", cold: "acceptable", wind: "poor", heat: "good" };
  const SMITHSONIAN_CLOSED = { weekdays: [], holidays: ["christmas"] };
  const FEDERAL_CLOSED = { weekdays: [0], holidays: ["thanksgiving", "christmas", "newyear"] };

  const venues = [
    { id: "us-capitol", name: "U.S. Capitol", seed: 1, priority_tier: "protected", period: "day", load: "hi", environment: "mixed",
      min_hours: 2.5, ideal_hours: 4, shortenable: false, reservation: "recommended",
      weather: { rain: "good", cold: "good", wind: "good", heat: "good" }, bundle: "capitol-hill", closures: FEDERAL_CLOSED },
    { id: "national-archives", name: "National Archives", seed: 2, priority_tier: "protected", period: "day", load: "lo", environment: "indoor",
      min_hours: 1.5, ideal_hours: 2.5, shortenable: true, reservation: "recommended",
      weather: INDOOR_ALL, bundle: null, closures: { weekdays: [], holidays: ["thanksgiving", "christmas"] } },
    { id: "lincoln-memorial", name: "Lincoln Memorial", seed: 3, priority_tier: "protected", period: "night", load: "hi", environment: "outdoor",
      min_hours: 0.5, ideal_hours: 1, shortenable: false, reservation: "none", weather: MEMORIAL, bundle: "main-memorial-loop" },
    { id: "library-of-congress", name: "Library of Congress", seed: 4, priority_tier: "protected", period: "day", load: "hi", environment: "indoor",
      min_hours: 1.5, ideal_hours: 2.5, shortenable: true, reservation: "required", weather: INDOOR_ALL, bundle: "capitol-hill", closures: FEDERAL_CLOSED },
    { id: "vietnam-memorial", name: "Vietnam Veterans Memorial", seed: 5, priority_tier: "protected", period: "night", load: "hi", environment: "outdoor",
      min_hours: 0.5, ideal_hours: 0.75, shortenable: false, reservation: "none", weather: MEMORIAL, bundle: "main-memorial-loop" },
    { id: "air-space", name: "National Air and Space Museum", seed: 6, priority_tier: "high", period: "day", load: "hi", environment: "indoor",
      min_hours: 2.5, ideal_hours: 5, shortenable: true, reservation: "required", weather: INDOOR_ALL, bundle: null, closures: SMITHSONIAN_CLOSED },
    { id: "arlington", name: "Arlington National Cemetery", seed: 7, priority_tier: "high", period: "day", load: "hi", environment: "outdoor",
      min_hours: 3, ideal_hours: 5, shortenable: true, reservation: "none",
      weather: { rain: "poor", cold: "acceptable", wind: "poor", heat: "acceptable" }, bundle: null },
    { id: "wwii-memorial", name: "World War II Memorial", seed: 8, priority_tier: "protected", period: "night", load: "hi", environment: "outdoor",
      min_hours: 0.5, ideal_hours: 0.75, shortenable: false, reservation: "none", weather: MEMORIAL, bundle: "main-memorial-loop" },
    { id: "korean-memorial", name: "Korean War Veterans Memorial", seed: 9, priority_tier: "protected", period: "night", load: "hi", environment: "outdoor",
      min_hours: 0.5, ideal_hours: 0.75, shortenable: false, reservation: "none", weather: MEMORIAL, bundle: "main-memorial-loop" },
    { id: "white-house", name: "White House Exterior", seed: 10, priority_tier: "protected", period: "night", load: "mid", environment: "outdoor",
      min_hours: 0.5, ideal_hours: 1, shortenable: true, reservation: "none",
      weather: { rain: "poor", cold: "good", wind: "acceptable", heat: "good" }, bundle: "christmas-washington" },
    { id: "national-christmas-tree", name: "National Christmas Tree", seed: 11, priority_tier: "protected", period: "night", load: "mid", environment: "outdoor",
      min_hours: 0.5, ideal_hours: 1, shortenable: true, reservation: "none",
      weather: { rain: "poor", cold: "good", wind: "acceptable", heat: "good" }, bundle: "christmas-washington" },
    { id: "natural-history", name: "National Museum of Natural History", seed: 12, priority_tier: "medium", period: "day", load: "hi", environment: "indoor",
      min_hours: 2.5, ideal_hours: 5, shortenable: true, reservation: "none", weather: INDOOR_ALL, bundle: null, closures: SMITHSONIAN_CLOSED },
    { id: "american-history", name: "National Museum of American History", seed: 13, priority_tier: "medium", period: "day", load: "hi", environment: "indoor",
      min_hours: 2, ideal_hours: 4.5, shortenable: true, reservation: "none", weather: INDOOR_ALL, bundle: null, closures: SMITHSONIAN_CLOSED },
    { id: "african-american-history", name: "National Museum of African American History and Culture", seed: 14, priority_tier: "medium", period: "day", load: "hi", environment: "indoor",
      min_hours: 3, ideal_hours: 5, shortenable: true, reservation: "recommended", weather: INDOOR_ALL, bundle: null, closures: SMITHSONIAN_CLOSED },
    { id: "washington-monument", name: "Washington Monument", seed: 15, priority_tier: "medium", period: "day", load: "mid", environment: "mixed",
      min_hours: 1, ideal_hours: 2, shortenable: false, reservation: "required",
      weather: { rain: "poor", cold: "good", wind: "poor", heat: "acceptable" }, bundle: null, closures: { weekdays: [], holidays: ["christmas"] } },
    { id: "jefferson-memorial", name: "Jefferson Memorial", seed: 16, priority_tier: "medium", period: "night", load: "mid", environment: "outdoor",
      min_hours: 0.5, ideal_hours: 1, shortenable: false, reservation: "none", weather: MEMORIAL, bundle: "tidal-basin-loop" },
    { id: "mlk-memorial", name: "Martin Luther King Jr. Memorial", seed: 17, priority_tier: "medium", period: "night", load: "mid", environment: "outdoor",
      min_hours: 0.5, ideal_hours: 0.75, shortenable: false, reservation: "none", weather: MEMORIAL, bundle: "tidal-basin-loop" },
    { id: "fdr-memorial", name: "Franklin Delano Roosevelt Memorial", seed: 18, priority_tier: "medium", period: "night", load: "mid", environment: "outdoor",
      min_hours: 0.75, ideal_hours: 1.25, shortenable: true, reservation: "none", weather: MEMORIAL, bundle: "tidal-basin-loop" },
    { id: "national-gallery", name: "National Gallery of Art", seed: 19, priority_tier: "bonus", period: "day", load: "hi", environment: "indoor",
      min_hours: 2, ideal_hours: 4, shortenable: true, reservation: "none", weather: INDOOR_ALL, bundle: null, closures: { weekdays: [], holidays: ["christmas", "newyear"] } },
    { id: "georgetown", name: "Georgetown", seed: 20, priority_tier: "bonus", period: "day", load: "mid", environment: "mixed",
      min_hours: 2, ideal_hours: 4, shortenable: true, reservation: "none",
      weather: { rain: "poor", cold: "good", wind: "acceptable", heat: "acceptable" }, bundle: null },
    { id: "national-cathedral", name: "Washington National Cathedral", seed: 21, priority_tier: "bonus", period: "day", load: "mid", environment: "indoor",
      min_hours: 1.5, ideal_hours: 3, shortenable: true, reservation: "recommended", weather: INDOOR_ALL, bundle: null },
    { id: "fords-theatre", name: "Ford's Theatre", seed: 22, priority_tier: "bonus", period: "day", load: "lo", environment: "indoor",
      min_hours: 1, ideal_hours: 2, shortenable: true, reservation: "recommended", weather: INDOOR_ALL, bundle: null, closures: { weekdays: [], holidays: ["thanksgiving", "christmas"] } },
    { id: "zoolights", name: "ZooLights", seed: 23, priority_tier: "bonus", period: "night", load: "mid", environment: "outdoor",
      min_hours: 1.5, ideal_hours: 2.5, shortenable: true, reservation: "recommended",
      weather: { rain: "poor", cold: "good", wind: "acceptable", heat: "good" }, bundle: null },
    { id: "holiday-market", name: "DowntownDC Holiday Market", seed: 24, priority_tier: "bonus", period: "day", load: "lo", environment: "outdoor",
      min_hours: 1, ideal_hours: 2, shortenable: true, reservation: "none",
      weather: { rain: "poor", cold: "good", wind: "acceptable", heat: "good" }, bundle: "christmas-washington" },
    { id: "spy-museum", name: "International Spy Museum", seed: 25, priority_tier: "bonus", period: "day", load: "mid", environment: "indoor",
      min_hours: 2, ideal_hours: 3, shortenable: true, reservation: "recommended", weather: INDOOR_ALL, bundle: null },
  ];

  /*
   * Bundles: members the scheduler moves together. Bundle-level load replaces
   * the sum of member loads. `core` members must all be present for the bundle
   * to count; `accessory` members ride along when the matching slot is free.
   */
  const bundles = {
    "capitol-hill": { name: "Capitol Hill", short: "Capitol + Library of Congress", period: "day", load: "hi", environment: "mixed",
      core: ["us-capitol", "library-of-congress"], accessory: [], together: true },
    "main-memorial-loop": { name: "The memorial loop", short: "WWII → Vietnam → Lincoln → Korea", period: "night", load: "hi", environment: "outdoor",
      core: ["wwii-memorial", "vietnam-memorial", "lincoln-memorial", "korean-memorial"], accessory: [], together: true },
    "christmas-washington": { name: "Christmas Washington", short: "White House + National Christmas Tree", period: "night", load: "mid", environment: "outdoor",
      core: ["white-house", "national-christmas-tree"], accessory: ["holiday-market"], together: true, prefer_weekday: 6 },
    "tidal-basin-loop": { name: "The Tidal Basin after dark", short: "Jefferson → FDR → MLK", period: "night", load: "mid", environment: "outdoor",
      core: ["jefferson-memorial", "fdr-memorial", "mlk-memorial"], accessory: [], together: true },
  };

  /* Same-day pairings the trip has real reasons for. */
  const pairings = [
    { day: "national-archives", night: "main-memorial-loop",
      reason: "The Archives is the light day that makes the memorial night humane." },
  ];

  /*
   * The recommended order of the core week, used only to break ties between
   * otherwise equal placements so the recommended trip stays recognizable.
   */
  const preferred_order = ["air-space", "capitol-hill", "national-archives", "natural-history", "arlington", "christmas-washington"];

  /* Structural days: not venues, not overridable, part of the trip's shape. */
  const structural = {
    arrival: { day: { label: "Arrive, hotel, food", load: "lo" }, night: { label: "The Capitol, illuminated", load: "mid" } },
    departure: { night: { label: "Southbound sleeper", load: "lo" } },
    rest: { label: "Dinner, nothing scheduled", load: "lo" },
    open: { label: "Nothing scheduled, on purpose", load: "lo" },
  };

  /* Copy per schedulable unit (bundle or standalone venue). Presentation only. */
  const copy = {
    "capitol-hill": {
      title: "Capitol Hill",
      body: ["Morning tour inside the U.S. Capitol, under the dome. Lunch. Then across the street to the Library of Congress, where the Great Hall of the Jefferson Building is the single most beautiful room in the country. Argue with us after you've seen it."],
      photo: ["day-1201-loc-great-hall.webp", "The Great Hall, Library of Congress"],
    },
    "national-archives": {
      title: "The founding documents",
      body: ["A short daytime visit to the National Archives to stand in front of the Declaration of Independence, the Constitution, and the Bill of Rights. The real ones. Then back to the hotel to warm up and rest."],
      short: ["Check out, leave the bags with the hotel, and give the morning to the Archives: the Declaration, the Constitution, and the Bill of Rights, and not much else. Lunch, luggage, Union Station, and the Crescent south."],
    },
    "main-memorial-loop": {
      title: "the big memorial night", featured: true,
      body: ["Reach the Vietnam Wall at dusk while the names are still easy to read. Then let it get dark: World War II Memorial, up the steps to Lincoln, and finally the Korean War Memorial, where the statues come alive under the lights. Bundle up. Hot chocolate after. This is the night we'll talk about for years."],
      photo: ["day-1202-lincoln-night.webp", "Lincoln Memorial after dark"],
    },
    "air-space": {
      title: "Air & Space",
      body: ["A whole day for the National Air and Space Museum. Real spacecraft. Real rockets. The planes that changed everything, hanging right over your head. We go at our own pace and leave when we're full."],
      short: ["Check out, leave the bags with the hotel, and give the morning to Air and Space: the Wright Flyer, the Spirit of St. Louis, an Apollo capsule, and whatever else pulls hardest. A couple of hours, not the full day. Lunch, luggage, Union Station, and the Crescent south."],
      photo: ["day-1130-air-space.webp", "National Air and Space Museum"],
    },
    "arlington": {
      title: "Arlington",
      body: ["One Metro ride across the river to Arlington National Cemetery. The Tomb of the Unknown Soldier and the Changing of the Guard, which we build the whole day around. President Kennedy's gravesite and the eternal flame. Arlington House on the hill, looking back over the whole city. Quiet, cold, and unforgettable."],
      photo: ["day-1204-arlington-guard.webp", "Changing of the Guard, Tomb of the Unknown Soldier"],
    },
    "christmas-washington": {
      title: "Christmas Washington", featured: true,
      body: ["After dark: the White House, the Ellipse, and the National Christmas Tree if this year's lighting has happened by then, with the state and territory trees around it. This night isn't for learning anything. It's for lights, cocoa, and seasonal nonsense."],
      photo: ["day-1205-national-christmas-tree.webp", "The National Christmas Tree on the Ellipse"],
    },
    "holiday-market": {
      title: "the holiday market",
      body: ["Sleep in. Wander the holiday market and the downtown decorations, poke around the shops, get lunch and something warm to drink. Then back to the hotel for an afternoon reset."],
      short: ["Check out, leave the bags, and stroll the holiday market downtown for an hour. Lunch, luggage, Union Station, and the Crescent south."],
    },
    "natural-history": {
      title: "Natural History",
      body: ["Dinosaurs. The Hope Diamond. The elephant in the rotunda. The ocean hall, the mammals, the giant squid. Sam, this is your day. We stay until everyone has seen the thing they came for."],
      short: ["Check out, leave the bags with the hotel, and give the morning to Natural History: the elephant, the dinosaurs, the Hope Diamond, and not much else. The greatest-hits version. Lunch, luggage, Union Station, and the Crescent south."],
      photo: ["day-1203-natural-history.webp", "National Museum of Natural History"],
    },
    "american-history": {
      title: "American History",
      body: ["The National Museum of American History. The Star-Spangled Banner, the actual flag from the actual song, plus the presidents, the trains, the inventions, and whatever else pulls us in."],
      short: ["Check out, leave the bags with the hotel, and spend the morning at the National Museum of American History. The Star-Spangled Banner, the actual flag from the actual song, plus the presidents, the trains, the inventions, and whatever else pulls us in. Lunch, grab the luggage, Union Station, and the Crescent south."],
      photo: ["day-1206-american-history.webp", "National Museum of American History"],
    },
    "african-american-history": {
      title: "African American History & Culture",
      body: ["The National Museum of African American History and Culture, top to bottom: start underground in the history galleries and climb toward the culture floors. It's big, it's heavy in places, and it's one of the best museums in the country. Leave when everyone's full."],
      short: ["Check out, leave the bags, and give the morning to the history galleries at the African American History museum. Lunch, luggage, Union Station, and the Crescent south."],
    },
    "washington-monument": {
      title: "the Washington Monument",
      body: ["Up the Washington Monument, if the timed tickets come through. The view from the top is the whole trip laid out at once: the Capitol one way, Lincoln the other, Arlington across the river."],
    },
    "tidal-basin-loop": {
      title: "the Tidal Basin after dark",
      body: ["The quieter memorial walk: Jefferson across the water, the FDR memorial's waterfalls and rooms, and Dr. King looking out over the basin. Less crowded than the Mall, just as good under lights."],
    },
    "national-gallery": {
      title: "the National Gallery",
      body: ["The National Gallery of Art, at whatever pace the family has left. The West Building for the old masters, the East Building for the strange and modern, and the underground walkway between them."],
      short: ["Check out, leave the bags, and give the morning to the National Gallery's greatest hits. Lunch, luggage, Union Station, and the Crescent south."],
    },
    "georgetown": {
      title: "Georgetown",
      body: ["A wander through Georgetown: the old brick streets, the canal, the shops, and lunch somewhere warm. Not a museum. That's the point."],
    },
    "national-cathedral": {
      title: "the National Cathedral",
      body: ["The Washington National Cathedral, up on its hill: the stained glass, the gargoyles, the Darth Vader grotesque if you can find it, and the quietest hour of the trip."],
      short: ["Check out, leave the bags, and take a slow morning at the National Cathedral. Lunch, luggage, Union Station, and the Crescent south."],
    },
    "fords-theatre": {
      title: "Ford's Theatre",
      body: ["Ford's Theatre and the Petersen House across the street. An hour or two, and it lands harder than you expect."],
      short: ["Check out, leave the bags, and spend an hour at Ford's Theatre. Lunch, luggage, Union Station, and the Crescent south."],
    },
    "zoolights": {
      title: "ZooLights",
      body: ["ZooLights at the National Zoo: the whole place strung with lights, hot drinks, and a lot of walking downhill and then, regrettably, back up."],
    },
    "spy-museum": {
      title: "the Spy Museum",
      body: ["The International Spy Museum. Not free, not on the Mall, and Sam will talk about it for a month."],
      short: ["Check out, leave the bags, and give the morning to the Spy Museum. Lunch, luggage, Union Station, and the Crescent south."],
    },
  };

  /* The thirteen headline experiences the page's list tracks. */
  const headlines = [
    "us-capitol", "library-of-congress", "air-space", "natural-history", "american-history", "national-archives",
    "white-house", "lincoln-memorial", "vietnam-memorial", "korean-memorial", "wwii-memorial", "arlington", "national-christmas-tree",
  ];

  const catalog = { venues, bundles, pairings, preferred_order, structural, copy, headlines };
  if (typeof module !== "undefined" && module.exports) { module.exports = catalog; return; }
  root.DCVenues = catalog;
})(typeof window !== "undefined" ? window : globalThis);
