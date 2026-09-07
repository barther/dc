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
 *   constraints   standing rules: closed weekdays (0 = Sunday) and holiday policy.
 *                 Date-specific closures are trip constraints, passed to the planner.
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
    { id: "us-capitol", ll: [38.8899, -77.0091], name: "U.S. Capitol", seed: 1, priority_tier: "protected", period: "day", load: "hi", environment: "mixed",
      min_hours: 2.5, ideal_hours: 4, shortenable: false, reservation: "recommended",
      weather: { rain: "good", cold: "good", wind: "good", heat: "good" }, bundle: "capitol-hill", constraints: FEDERAL_CLOSED },
    { id: "national-archives", ll: [38.8926, -77.023], name: "National Archives", seed: 2, priority_tier: "protected", period: "day", load: "lo", environment: "indoor",
      min_hours: 1.5, ideal_hours: 2.5, shortenable: true, reservation: "recommended",
      weather: INDOOR_ALL, bundle: null, constraints: { weekdays: [], holidays: ["thanksgiving", "christmas"] } },
    { id: "lincoln-memorial", ll: [38.8893, -77.0502], name: "Lincoln Memorial", seed: 3, priority_tier: "protected", period: "night", load: "hi", environment: "outdoor",
      min_hours: 0.5, ideal_hours: 1, shortenable: false, reservation: "none", weather: MEMORIAL, bundle: "main-memorial-loop" },
    { id: "library-of-congress", ll: [38.8887, -77.0047], name: "Library of Congress", seed: 4, priority_tier: "protected", period: "day", load: "hi", environment: "indoor",
      min_hours: 1.5, ideal_hours: 2.5, shortenable: true, reservation: "required", weather: INDOOR_ALL, bundle: "capitol-hill", constraints: FEDERAL_CLOSED },
    { id: "vietnam-memorial", ll: [38.8912, -77.0477], name: "Vietnam Veterans Memorial", seed: 5, priority_tier: "protected", period: "night", load: "hi", environment: "outdoor",
      min_hours: 0.5, ideal_hours: 0.75, shortenable: false, reservation: "none", weather: MEMORIAL, bundle: "main-memorial-loop" },
    { id: "air-space", ll: [38.8882, -77.0199], name: "National Air and Space Museum", seed: 6, priority_tier: "high", period: "day", load: "hi", environment: "indoor",
      min_hours: 2.5, ideal_hours: 5, shortenable: true, reservation: "required", weather: INDOOR_ALL, bundle: null, constraints: SMITHSONIAN_CLOSED },
    { id: "arlington", ll: [38.8787, -77.0675], go: "metro", name: "Arlington National Cemetery", seed: 7, priority_tier: "high", period: "day", load: "hi", environment: "outdoor",
      min_hours: 3, ideal_hours: 5, shortenable: true, reservation: "none",
      weather: { rain: "poor", cold: "acceptable", wind: "poor", heat: "acceptable" }, bundle: null },
    { id: "wwii-memorial", ll: [38.8894, -77.0405], name: "World War II Memorial", seed: 8, priority_tier: "protected", period: "night", load: "hi", environment: "outdoor",
      min_hours: 0.5, ideal_hours: 0.75, shortenable: false, reservation: "none", weather: MEMORIAL, bundle: "main-memorial-loop" },
    { id: "korean-memorial", ll: [38.8876, -77.0477], name: "Korean War Veterans Memorial", seed: 9, priority_tier: "protected", period: "night", load: "hi", environment: "outdoor",
      min_hours: 0.5, ideal_hours: 0.75, shortenable: false, reservation: "none", weather: MEMORIAL, bundle: "main-memorial-loop" },
    { id: "white-house", ll: [38.8977, -77.0365], name: "White House Exterior", seed: 10, priority_tier: "protected", period: "night", load: "mid", environment: "outdoor",
      min_hours: 0.5, ideal_hours: 1, shortenable: true, reservation: "none",
      weather: { rain: "poor", cold: "good", wind: "acceptable", heat: "good" }, bundle: "christmas-washington" },
    { id: "national-christmas-tree", ll: [38.8946, -77.0366], name: "National Christmas Tree", seed: 11, priority_tier: "protected", period: "night", load: "mid", environment: "outdoor",
      min_hours: 0.5, ideal_hours: 1, shortenable: true, reservation: "none",
      weather: { rain: "poor", cold: "good", wind: "acceptable", heat: "good" }, bundle: "christmas-washington" },
    { id: "natural-history", ll: [38.8913, -77.0261], name: "National Museum of Natural History", seed: 12, priority_tier: "medium", period: "day", load: "hi", environment: "indoor",
      min_hours: 2.5, ideal_hours: 5, shortenable: true, reservation: "none", weather: INDOOR_ALL, bundle: null, constraints: SMITHSONIAN_CLOSED },
    { id: "american-history", ll: [38.8913, -77.03], name: "National Museum of American History", seed: 13, priority_tier: "medium", period: "day", load: "hi", environment: "indoor",
      min_hours: 2, ideal_hours: 4.5, shortenable: true, reservation: "none", weather: INDOOR_ALL, bundle: null, constraints: SMITHSONIAN_CLOSED },
    { id: "african-american-history", ll: [38.891, -77.0326], name: "National Museum of African American History and Culture", seed: 14, priority_tier: "medium", period: "day", load: "hi", environment: "indoor",
      min_hours: 3, ideal_hours: 5, shortenable: true, reservation: "recommended", weather: INDOOR_ALL, bundle: null, constraints: SMITHSONIAN_CLOSED },
    { id: "washington-monument", ll: [38.8895, -77.0353], name: "Washington Monument", seed: 15, priority_tier: "medium", period: "day", load: "mid", environment: "mixed",
      min_hours: 1, ideal_hours: 2, shortenable: false, reservation: "required",
      weather: { rain: "poor", cold: "good", wind: "poor", heat: "acceptable" }, bundle: null, constraints: { weekdays: [], holidays: ["christmas"] } },
    { id: "jefferson-memorial", ll: [38.8814, -77.0365], name: "Jefferson Memorial", seed: 16, priority_tier: "medium", period: "night", load: "mid", environment: "outdoor",
      min_hours: 0.5, ideal_hours: 1, shortenable: false, reservation: "none", weather: MEMORIAL, bundle: "tidal-basin-loop" },
    { id: "mlk-memorial", ll: [38.8862, -77.0442], name: "Martin Luther King Jr. Memorial", seed: 17, priority_tier: "medium", period: "night", load: "mid", environment: "outdoor",
      min_hours: 0.5, ideal_hours: 0.75, shortenable: false, reservation: "none", weather: MEMORIAL, bundle: "tidal-basin-loop" },
    { id: "fdr-memorial", ll: [38.8838, -77.0421], name: "Franklin Delano Roosevelt Memorial", seed: 18, priority_tier: "medium", period: "night", load: "mid", environment: "outdoor",
      min_hours: 0.75, ideal_hours: 1.25, shortenable: true, reservation: "none", weather: MEMORIAL, bundle: "tidal-basin-loop" },
    { id: "national-gallery", ll: [38.8913, -77.0199], name: "National Gallery of Art", seed: 19, priority_tier: "bonus", period: "day", load: "hi", environment: "indoor",
      min_hours: 2, ideal_hours: 4, shortenable: true, reservation: "none", weather: INDOOR_ALL, bundle: null, constraints: { weekdays: [], holidays: ["christmas", "newyear"] } },
    { id: "georgetown", ll: [38.9076, -77.0623], name: "Georgetown", seed: 20, priority_tier: "bonus", period: "day", load: "mid", environment: "mixed",
      min_hours: 2, ideal_hours: 4, shortenable: true, reservation: "none",
      weather: { rain: "poor", cold: "good", wind: "acceptable", heat: "acceptable" }, bundle: null },
    { id: "national-cathedral", ll: [38.9305, -77.0708], name: "Washington National Cathedral", seed: 21, priority_tier: "bonus", period: "day", load: "mid", environment: "indoor",
      min_hours: 1.5, ideal_hours: 3, shortenable: true, reservation: "recommended", weather: INDOOR_ALL, bundle: null },
    { id: "fords-theatre", ll: [38.8967, -77.0258], name: "Ford's Theatre", seed: 22, priority_tier: "bonus", period: "day", load: "lo", environment: "indoor",
      min_hours: 1, ideal_hours: 2, shortenable: true, reservation: "recommended", weather: INDOOR_ALL, bundle: null, constraints: { weekdays: [], holidays: ["thanksgiving", "christmas"] } },
    { id: "zoolights", ll: [38.9296, -77.0498], name: "ZooLights", seed: 23, priority_tier: "bonus", period: "night", load: "mid", environment: "outdoor",
      min_hours: 1.5, ideal_hours: 2.5, shortenable: true, reservation: "recommended",
      weather: { rain: "poor", cold: "good", wind: "acceptable", heat: "good" }, bundle: null },
    { id: "holiday-market", ll: [38.8953, -77.0223], name: "DowntownDC Holiday Market", seed: 24, priority_tier: "bonus", period: "day", load: "lo", environment: "outdoor",
      min_hours: 1, ideal_hours: 2, shortenable: true, reservation: "none",
      weather: { rain: "poor", cold: "good", wind: "acceptable", heat: "good" }, bundle: "christmas-washington" },
    { id: "spy-museum", ll: [38.8837, -77.025], name: "International Spy Museum", seed: 25, priority_tier: "bonus", period: "day", load: "mid", environment: "indoor",
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
      body: ["Morning tour inside the U.S. Capitol, under the dome. Lunch. Then across the street to the Library of Congress, where the Great Hall of the Jefferson Building is gilded and painted floor to ceiling."],
      photo: ["day-1201-loc-great-hall.webp", "The Great Hall, Library of Congress"],
    },
    "national-archives": {
      title: "The founding documents",
      body: ["A short daytime visit to the National Archives to stand in front of the Declaration of Independence, the Constitution, and the Bill of Rights. The real ones. Then back to the hotel to warm up and rest."],
      short: ["Check out, leave the bags with the hotel, and give the morning to the Archives: the Declaration, the Constitution, and the Bill of Rights, and not much else. Lunch, luggage, Union Station, and the Crescent south."],
      photo: ["unit-national-archives.webp", "The National Archives"],
    },
    "main-memorial-loop": {
      title: "the big memorial night",
      body: ["Reach the Vietnam Wall at dusk while the names are still easy to read. Then let it get dark: World War II Memorial, up the steps to Lincoln, and finally the Korean War Memorial, where the statues come alive under the lights. Bundle up. Hot chocolate after."],
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
      body: ["One Metro ride across the river to Arlington National Cemetery. The Tomb of the Unknown Soldier and the Changing of the Guard, which we build the whole day around. President Kennedy's gravesite and the eternal flame. Arlington House on the hill, looking back over the whole city. Quiet and cold."],
      photo: ["day-1204-arlington-guard.webp", "Changing of the Guard, Tomb of the Unknown Soldier"],
    },
    "christmas-washington": {
      title: "Christmas Washington",
      body: ["After dark: the White House, the Ellipse, and the National Christmas Tree if this year's lighting has happened by then, with the state and territory trees around it. No tour and no tickets. Lights, and something warm to drink."],
      photo: ["day-1205-national-christmas-tree.webp", "The National Christmas Tree on the Ellipse"],
    },
    "holiday-market": {
      title: "the holiday market",
      body: ["Sleep in. Wander the holiday market and the downtown decorations, poke around the shops, get lunch and something warm to drink. Then back to the hotel for an afternoon reset."],
      short: ["Check out, leave the bags, and stroll the holiday market downtown for an hour. Lunch, luggage, Union Station, and the Crescent south."],
    },
    "natural-history": {
      title: "Natural History",
      body: ["Dinosaurs. The Hope Diamond. The elephant in the rotunda. The ocean hall, the mammals, the giant squid. We stay until everyone has seen the thing they came for."],
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
      body: ["The National Museum of African American History and Culture, top to bottom: start underground in the history galleries and climb toward the culture floors. It's big, and it's heavy in places. Leave when everyone's full."],
      short: ["Check out, leave the bags, and give the morning to the history galleries at the African American History museum. Lunch, luggage, Union Station, and the Crescent south."],
      photo: ["unit-african-american-history.webp", "National Museum of African American History and Culture"],
    },
    "washington-monument": {
      title: "the Washington Monument",
      body: ["Up the Washington Monument, if the timed tickets come through. The view from the top is the whole trip laid out at once: the Capitol one way, Lincoln the other, Arlington across the river."],
      photo: ["unit-washington-monument.webp", "The Washington Monument from the Mall"],
    },
    "tidal-basin-loop": {
      title: "the Tidal Basin after dark",
      body: ["The quieter memorial walk: Jefferson across the water, the FDR memorial's waterfalls and rooms, and Dr. King looking out over the basin. Less crowded than the Mall, and lit the same way after dark."],
      photo: ["unit-tidal-basin-loop.webp", "The Jefferson Memorial across the Tidal Basin"],
    },
    "national-gallery": {
      title: "the National Gallery",
      body: ["The National Gallery of Art, at whatever pace the family has left. The West Building for the old masters, the East Building for the strange and modern, and the underground walkway between them."],
      short: ["Check out, leave the bags, and give the morning to the National Gallery's greatest hits. Lunch, luggage, Union Station, and the Crescent south."],
      photo: ["unit-national-gallery.webp", "National Gallery of Art"],
    },
    "georgetown": {
      title: "Georgetown",
      body: ["A wander through Georgetown: the old brick streets, the canal, the shops, and lunch somewhere warm. Not a museum."],
      photo: ["unit-georgetown.webp", "Georgetown in December"],
    },
    "national-cathedral": {
      title: "the National Cathedral",
      body: ["The Washington National Cathedral, up on its hill: the stained glass, the gargoyles, and the Darth Vader grotesque if you can find it."],
      short: ["Check out, leave the bags, and take a slow morning at the National Cathedral. Lunch, luggage, Union Station, and the Crescent south."],
      photo: ["unit-national-cathedral.webp", "Washington National Cathedral"],
    },
    "fords-theatre": {
      title: "Ford's Theatre",
      body: ["Ford's Theatre and the Petersen House across the street. An hour or two."],
      short: ["Check out, leave the bags, and spend an hour at Ford's Theatre. Lunch, luggage, Union Station, and the Crescent south."],
      photo: ["unit-fords-theatre.webp", "Ford's Theatre"],
    },
    "zoolights": {
      title: "ZooLights",
      body: ["ZooLights at the National Zoo: the whole place strung with lights, hot drinks, and a long walk downhill and back up."],
      photo: ["unit-zoolights.webp", "ZooLights at the National Zoo"],
    },
    "spy-museum": {
      title: "the Spy Museum",
      body: ["The International Spy Museum. Not free, and not on the Mall."],
      short: ["Check out, leave the bags, and give the morning to the Spy Museum. Lunch, luggage, Union Station, and the Crescent south."],
      photo: ["unit-spy-museum.webp", "The International Spy Museum"],
    },
  };

  /* The thirteen headline experiences the page's list tracks. */
  const headlines = [
    "us-capitol", "library-of-congress", "air-space", "natural-history", "american-history", "national-archives",
    "white-house", "lincoln-memorial", "vietnam-memorial", "korean-memorial", "wwii-memorial", "arlington", "national-christmas-tree",
  ];

  /* Geography. Home base is L'Enfant Plaza; straight-line miles are close enough on a flat grid
     to decide "walk or call a car". A leg over WALK miles is a ride; `go: "metro"` names the one-seat train. */
  const base = { name: "the hotel", ll: [38.8845, -77.0255] };
  const WALK = 1.1;
  function distMi(a, b) {
    const R = 3958.8, toR = (x) => (x * Math.PI) / 180;
    const dLat = toR(b[0] - a[0]), dLon = toR(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a[0])) * Math.cos(toR(b[0])) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const geo = { base, WALK, distMi, ride: "ride" };

  /* The city: everything the pages say that isn't about a venue. Prose lives here so the
     same pages can serve another city from another catalog in this shape. */
  const city = {
    id: "dc", name: "Washington", short: "DC", title: ["Washington,", "for Christmas."],
    station: "Washington Union Station", stationShort: "Union Station", hotel: "L'Enfant Plaza",
    lede: "in the capital. Sleeper cars there and back. The Capitol lit up at night, dinosaurs, the Hope Diamond, the actual Declaration of Independence, and a whole city dressed for Christmas.",
    reelIntro: "Everything Washington has for us, and no schedule yet.",
    trainIntro: "No airport. No rental car. We board the Amtrak Crescent in Anniston after Bart gets off work, settle into two sleeper rooms across the hall from each other, sleep through Georgia and the Carolinas, and wake up in Virginia. Sunday afternoon we roll into Union Station, three blocks from the Capitol.",
    homeBase: "We're aiming for L'Enfant Plaza, a short walk from Air & Space, Natural History, and the Washington Monument, with a one-seat Metro ride to Arlington.",
    thesis: "Leave Washington feeling like we actually saw Washington, without needing a vacation from the vacation.",
    plate: { photo: "hero-capitol-night.webp", alt: "The U.S. Capitol at night", title: "The Capitol", sub: "lit for the night" },
    // The Crescent: labels for the board, and the hour the countdown points at.
    train: { boardLabel: "evening", arriveWeekend: "~2:12 PM", arriveWeekday: "afternoon, per the timetable", departLabel: "6:30 PM", homeLabel: "~10:30 AM CT", arriveHour: 14.2 },
    // Structural prose for the week.
    narrative: {
      arrivalTitle: "Hello, Washington.",
      arrivalBody: "Roll into Union Station, check into the hotel, unpack, eat. Then, after dark, our first real look at the city: the U.S. Capitol dome lit up against the night sky. No tour. No agenda. Just stand there and take it in.",
      arrivalPhoto: ["day-1129-union-station.webp", "The main hall at Union Station"],
      departureTail: "Lunch, luggage, Union Station, and the Crescent south.",
      lastMorning: "Check out, leave the bags with the hotel, a slow breakfast, and one last walk on the Mall. Lunch, luggage, Union Station, and the Crescent south. Nothing big on purpose.",
    },
  };

  /* What makes this trip this trip. Lose one and it's a different kind of trip, which is fine as long as we know it. */
  const identity = {
    civic: { name: "the Capitol", any: ["us-capitol", "library-of-congress"] },
    documents: { name: "the founding documents", any: ["national-archives"] },
    memorials: { name: "the memorial night", all: ["lincoln-memorial", "vietnam-memorial", "wwii-memorial", "korean-memorial"] },
    christmas: { name: "Christmas Washington", all: ["white-house", "national-christmas-tree"] },
    smithsonian: { name: "a major Smithsonian", any: ["air-space", "natural-history", "american-history", "african-american-history"] },
  };

  const catalog = { venues, bundles, pairings, preferred_order, structural, copy, headlines, geo, city, identity };
  if (typeof module !== "undefined" && module.exports) { module.exports = catalog; return; }
  root.DCVenues = catalog;
})(typeof window !== "undefined" ? window : globalThis);
