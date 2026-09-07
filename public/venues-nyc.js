/*
 * New York catalog. The same shape as venues.js, so the same planner, bracket, and pages
 * run over it: seeds, tiers, day/night, load, hours, tickets, weather fit, bundles,
 * pairings, structural days, copy, geography, and the city's own prose and train facts.
 *
 * Contenders here: six bundles and fifteen standalones, twenty-one in all, so the bracket
 * is a sixteen with five play-ins. The engine is generic; nothing else changes.
 */
(function (root) {
  "use strict";

  const INDOOR_ALL = { rain: "excellent", cold: "excellent", wind: "excellent", heat: "excellent" };
  const OUTDOOR_XMAS = { rain: "poor", cold: "excellent", wind: "acceptable", heat: "good" };
  const OPEN_DAILY = { weekdays: [], holidays: ["christmas"] };
  const MUSEUM_CLOSED = { weekdays: [], holidays: ["thanksgiving", "christmas"] };

  const venues = [
    { id: "rockefeller-christmas", ll: [40.7587, -73.9787], name: "Rockefeller Center Christmas Tree", seed: 1, priority_tier: "protected", period: "night", load: "mid", environment: "outdoor",
      min_hours: 0.75, ideal_hours: 1.5, shortenable: true, reservation: "none", weather: OUTDOOR_XMAS, bundle: "rockefeller-christmas", constraints: { weekdays: [], holidays: [], season: { from: "12-03", to: "01-10", note: "lit from the first Wednesday of December; dates vary by year" } } },
    { id: "central-park", ll: [40.7712, -73.9742], name: "Central Park", seed: 2, priority_tier: "protected", period: "day", load: "hi", environment: "outdoor",
      min_hours: 2, ideal_hours: 4, shortenable: true, reservation: "none", weather: { rain: "poor", cold: "good", wind: "acceptable", heat: "acceptable" }, bundle: null, constraints: { weekdays: [], holidays: [] } },
    { id: "statue-liberty", ll: [40.6892, -74.0445], go: "subway", name: "Statue of Liberty", seed: 3, priority_tier: "protected", period: "day", load: "hi", environment: "mixed",
      min_hours: 3, ideal_hours: 5, shortenable: false, reservation: "required", weather: { rain: "poor", cold: "acceptable", wind: "poor", heat: "acceptable" }, bundle: "liberty-ellis", constraints: OPEN_DAILY },
    { id: "ellis-island", ll: [40.6995, -74.0396], name: "Ellis Island", seed: 4, priority_tier: "protected", period: "day", load: "hi", environment: "mixed",
      min_hours: 2, ideal_hours: 3, shortenable: true, reservation: "required", weather: { rain: "acceptable", cold: "acceptable", wind: "poor", heat: "acceptable" }, bundle: "liberty-ellis", constraints: OPEN_DAILY },
    { id: "metropolitan-museum", ll: [40.7794, -73.9632], name: "The Metropolitan Museum of Art", seed: 5, priority_tier: "protected", period: "day", load: "hi", environment: "indoor",
      min_hours: 2.5, ideal_hours: 5, shortenable: true, reservation: "recommended", weather: INDOOR_ALL, bundle: null, constraints: { weekdays: [3], holidays: ["thanksgiving", "christmas", "newyear"] } },
    { id: "broadway-show", ll: [40.759, -73.9866], name: "A Broadway show", seed: 6, priority_tier: "protected", period: "night", load: "mid", environment: "indoor",
      min_hours: 2.5, ideal_hours: 3.5, shortenable: false, reservation: "required", weather: INDOOR_ALL, bundle: "theater-district", constraints: { weekdays: [], holidays: [] } },
    { id: "nine-eleven-museum", ll: [40.7115, -74.0125], name: "9/11 Memorial Museum", seed: 7, priority_tier: "high", period: "day", load: "hi", environment: "indoor",
      min_hours: 2, ideal_hours: 4, shortenable: true, reservation: "recommended", weather: INDOOR_ALL, bundle: "world-trade-center", constraints: MUSEUM_CLOSED },
    { id: "nine-eleven-memorial", ll: [40.7115, -74.0134], name: "9/11 Memorial", seed: 8, priority_tier: "high", period: "day", load: "lo", environment: "outdoor",
      min_hours: 0.5, ideal_hours: 1, shortenable: true, reservation: "none", weather: { rain: "poor", cold: "good", wind: "acceptable", heat: "good" }, bundle: "world-trade-center", constraints: { weekdays: [], holidays: [] } },
    { id: "top-of-the-rock", ll: [40.7588, -73.9791], name: "Top of the Rock", seed: 9, priority_tier: "high", period: "night", load: "mid", environment: "mixed",
      min_hours: 1.5, ideal_hours: 2, shortenable: false, reservation: "required", weather: { rain: "poor", cold: "good", wind: "poor", heat: "acceptable" }, bundle: null, constraints: { weekdays: [], holidays: [] } },
    { id: "amnh", ll: [40.7813, -73.974], name: "American Museum of Natural History", seed: 10, priority_tier: "high", period: "day", load: "hi", environment: "indoor",
      min_hours: 2.5, ideal_hours: 5, shortenable: true, reservation: "recommended", weather: INDOOR_ALL, bundle: null, constraints: MUSEUM_CLOSED },
    { id: "fifth-avenue-christmas", ll: [40.759, -73.977], name: "Fifth Avenue Christmas windows", seed: 11, priority_tier: "high", period: "night", load: "mid", environment: "outdoor",
      min_hours: 1.5, ideal_hours: 2.5, shortenable: true, reservation: "none", weather: OUTDOOR_XMAS, bundle: "rockefeller-christmas", constraints: { weekdays: [], holidays: [], season: { from: "11-15", to: "01-01", note: "typical dates; check the year's" } } },
    { id: "grand-central", ll: [40.7527, -73.9772], name: "Grand Central Terminal", seed: 12, priority_tier: "high", period: "day", load: "lo", environment: "indoor",
      min_hours: 0.75, ideal_hours: 1.5, shortenable: true, reservation: "none", weather: INDOOR_ALL, bundle: null, constraints: { weekdays: [], holidays: [] } },
    { id: "bryant-park", ll: [40.7536, -73.9832], name: "Bryant Park Winter Village", seed: 13, priority_tier: "high", period: "night", load: "mid", environment: "outdoor",
      min_hours: 1, ideal_hours: 2, shortenable: true, reservation: "none", weather: OUTDOOR_XMAS, bundle: null, constraints: { weekdays: [], holidays: [], season: { from: "10-25", to: "03-01", note: "the Winter Village's typical run" } } },
    { id: "ny-public-library", ll: [40.7532, -73.9822], name: "New York Public Library", seed: 14, priority_tier: "medium", period: "day", load: "lo", environment: "indoor",
      min_hours: 1, ideal_hours: 1.5, shortenable: true, reservation: "none", weather: INDOOR_ALL, bundle: null, constraints: { weekdays: [0], holidays: ["thanksgiving", "christmas", "newyear"] } },
    { id: "radio-city-christmas", ll: [40.76, -73.98], name: "Radio City Christmas Spectacular", seed: 15, priority_tier: "medium", period: "night", load: "mid", environment: "indoor",
      min_hours: 2, ideal_hours: 2.5, shortenable: false, reservation: "required", weather: INDOOR_ALL, bundle: null, constraints: { weekdays: [], holidays: [], season: { from: "11-07", to: "01-04", note: "typical dates; check the year's" } } },
    { id: "brooklyn-bridge", ll: [40.7061, -73.9969], go: "subway", name: "Brooklyn Bridge", seed: 16, priority_tier: "medium", period: "day", load: "mid", environment: "outdoor",
      min_hours: 1, ideal_hours: 1.5, shortenable: false, reservation: "none", weather: { rain: "poor", cold: "acceptable", wind: "poor", heat: "acceptable" }, bundle: "brooklyn-bridge-dumbo", constraints: { weekdays: [], holidays: [] } },
    { id: "dumbo", ll: [40.7033, -73.9903], name: "DUMBO and the Brooklyn waterfront", seed: 17, priority_tier: "medium", period: "day", load: "mid", environment: "outdoor",
      min_hours: 1.5, ideal_hours: 2.5, shortenable: true, reservation: "none", weather: { rain: "poor", cold: "acceptable", wind: "poor", heat: "acceptable" }, bundle: "brooklyn-bridge-dumbo", constraints: { weekdays: [], holidays: [] } },
    { id: "intrepid", ll: [40.7645, -73.9996], name: "Intrepid Museum", seed: 18, priority_tier: "medium", period: "day", load: "hi", environment: "mixed",
      min_hours: 2.5, ideal_hours: 4, shortenable: true, reservation: "recommended", weather: { rain: "acceptable", cold: "good", wind: "acceptable", heat: "acceptable" }, bundle: null, constraints: MUSEUM_CLOSED },
    { id: "moma", ll: [40.7614, -73.9776], name: "Museum of Modern Art", seed: 19, priority_tier: "medium", period: "day", load: "hi", environment: "indoor",
      min_hours: 2, ideal_hours: 4, shortenable: true, reservation: "recommended", weather: INDOOR_ALL, bundle: null, constraints: MUSEUM_CLOSED },
    { id: "high-line", ll: [40.748, -74.0048], name: "The High Line", seed: 20, priority_tier: "medium", period: "day", load: "mid", environment: "outdoor",
      min_hours: 1, ideal_hours: 2, shortenable: true, reservation: "none", weather: { rain: "poor", cold: "acceptable", wind: "poor", heat: "acceptable" }, bundle: "chelsea-high-line", constraints: { weekdays: [], holidays: [] } },
    { id: "chelsea-market", ll: [40.7424, -74.0061], name: "Chelsea Market", seed: 21, priority_tier: "medium", period: "day", load: "lo", environment: "indoor",
      min_hours: 1, ideal_hours: 2, shortenable: true, reservation: "none", weather: INDOOR_ALL, bundle: "chelsea-high-line", constraints: { weekdays: [], holidays: [] } },
    { id: "st-patricks", ll: [40.7585, -73.976], name: "St. Patrick's Cathedral", seed: 22, priority_tier: "medium", period: "day", load: "lo", environment: "indoor",
      min_hours: 0.5, ideal_hours: 1, shortenable: true, reservation: "none", weather: INDOOR_ALL, bundle: "rockefeller-christmas", constraints: { weekdays: [], holidays: [] } },
    { id: "times-square", ll: [40.758, -73.9855], name: "Times Square", seed: 23, priority_tier: "medium", period: "night", load: "lo", environment: "outdoor",
      min_hours: 0.5, ideal_hours: 1, shortenable: true, reservation: "none", weather: { rain: "poor", cold: "good", wind: "acceptable", heat: "acceptable" }, bundle: "theater-district", constraints: { weekdays: [], holidays: [] } },
    { id: "one-world-observatory", ll: [40.713, -74.0132], name: "One World Observatory", seed: 24, priority_tier: "bonus", period: "day", load: "mid", environment: "indoor",
      min_hours: 1.5, ideal_hours: 2, shortenable: false, reservation: "required", weather: { rain: "acceptable", cold: "excellent", wind: "excellent", heat: "excellent" }, bundle: null, constraints: { weekdays: [], holidays: [] } },
    { id: "empire-state-building", ll: [40.7484, -73.9857], name: "Empire State Building", seed: 25, priority_tier: "bonus", period: "night", load: "mid", environment: "mixed",
      min_hours: 1.5, ideal_hours: 2, shortenable: false, reservation: "required", weather: { rain: "poor", cold: "good", wind: "poor", heat: "acceptable" }, bundle: null, constraints: { weekdays: [], holidays: [] } },
    { id: "macys-herald-square", ll: [40.7508, -73.9895], name: "Macy's Herald Square", seed: 26, priority_tier: "bonus", period: "day", load: "lo", environment: "mixed",
      min_hours: 1, ideal_hours: 2, shortenable: true, reservation: "none", weather: { rain: "good", cold: "excellent", wind: "good", heat: "good" }, bundle: null, constraints: { weekdays: [], holidays: ["christmas"], season: { from: "11-20", to: "12-24", note: "Santaland's typical run" } } },
    { id: "greenwich-village", ll: [40.7336, -74.0027], name: "Greenwich Village", seed: 27, priority_tier: "bonus", period: "day", load: "mid", environment: "mixed",
      min_hours: 2, ideal_hours: 3, shortenable: true, reservation: "none", weather: { rain: "poor", cold: "good", wind: "acceptable", heat: "acceptable" }, bundle: null, constraints: { weekdays: [], holidays: [] } },
    { id: "chinatown-little-italy", ll: [40.7158, -73.997], name: "Chinatown and Little Italy", seed: 28, priority_tier: "bonus", period: "day", load: "mid", environment: "mixed",
      min_hours: 2, ideal_hours: 3, shortenable: true, reservation: "none", weather: { rain: "acceptable", cold: "good", wind: "acceptable", heat: "acceptable" }, bundle: null, constraints: { weekdays: [], holidays: [] } },
  ];

  /* Bundles are one slot each. A night bundle can carry a daytime accessory on the same day. */
  const bundles = {
    "rockefeller-christmas": { name: "Christmas Midtown", short: "Rockefeller tree + Fifth Avenue windows", period: "night", load: "hi", environment: "outdoor",
      core: ["rockefeller-christmas", "fifth-avenue-christmas"], accessory: ["st-patricks"], together: true },
    "liberty-ellis": { name: "Liberty and Ellis Island", short: "Statue of Liberty + Ellis Island", period: "day", load: "hi", environment: "mixed",
      core: ["statue-liberty", "ellis-island"], accessory: [], together: true },
    "world-trade-center": { name: "The World Trade Center", short: "9/11 Memorial + Museum", period: "day", load: "hi", environment: "mixed",
      core: ["nine-eleven-memorial", "nine-eleven-museum"], accessory: [], together: true },
    "brooklyn-bridge-dumbo": { name: "Brooklyn Bridge and DUMBO", short: "The bridge on foot + the waterfront", period: "day", load: "hi", environment: "outdoor",
      core: ["brooklyn-bridge", "dumbo"], accessory: [], together: true },
    "chelsea-high-line": { name: "Chelsea and the High Line", short: "Chelsea Market + the High Line", period: "day", load: "mid", environment: "mixed",
      core: ["chelsea-market", "high-line"], accessory: [], together: true },
    "theater-district": { name: "Broadway night", short: "A show + Times Square", period: "night", load: "mid", environment: "mixed",
      core: ["broadway-show", "times-square"], accessory: [], together: true },
  };

  /* Same-day pairings the trip has real reasons for. */
  const pairings = [
    { day: "ny-public-library", night: "bryant-park", reason: "Same block: the reading room by day, the Winter Village after dark." },
  ];

  const preferred_order = ["central-park", "liberty-ellis", "metropolitan-museum", "world-trade-center", "amnh", "rockefeller-christmas"];

  const structural = {
    arrival: { day: { label: "Arrive, hotel, food", load: "lo" }, night: { label: "A first look at Midtown after dark", load: "mid" } },
    departure: { night: { label: "Southbound sleeper", load: "lo" } },
    rest: { label: "Dinner, nothing scheduled", load: "lo" },
    open: { label: "Nothing scheduled, on purpose", load: "lo" },
  };

  /* Copy per schedulable unit. What a place is and how long it takes, and no more. */
  const copy = {
    "rockefeller-christmas": { title: "Christmas Midtown",
      body: ["After dark: the tree at Rockefeller Center with the rink below it, then the Fifth Avenue windows from Saks up past the Plaza. St. Patrick's is across the avenue by day. The tree is lit from the first Wednesday of December; before that it's a very large tree with the lights off."],
      photo: ["nyc/unit-rockefeller-christmas.webp", "The tree at Rockefeller Center"] },
    "liberty-ellis": { title: "Liberty and Ellis Island",
      body: ["One ferry from the Battery, two islands. The statue first, then Ellis Island and the registry room. Timed ferry tickets, and the pedestal or crown need their own. A full day with the boat lines counted."],
      photo: ["nyc/unit-liberty-ellis.webp", "The Statue of Liberty from the ferry"] },
    "world-trade-center": { title: "the World Trade Center",
      body: ["The memorial pools, then the museum underneath them. Two to four hours, and the museum is the heavy part. One World Observatory is next door on its own ticket."],
      short: ["Check out, leave the bags, and give the morning to the memorial pools and an hour in the museum. Lunch, luggage, Penn Station, and the Crescent south."],
      photo: ["nyc/unit-world-trade-center.webp", "The memorial pools"] },
    "brooklyn-bridge-dumbo": { title: "Brooklyn Bridge and DUMBO",
      body: ["Walk the bridge from the Manhattan side, then keep going: DUMBO, the waterfront park, the view back at the skyline. About three hours with a stop for lunch. Wind on the bridge counts."],
      photo: ["nyc/unit-brooklyn-bridge-dumbo.webp", "The Brooklyn Bridge walkway"] },
    "chelsea-high-line": { title: "Chelsea and the High Line",
      body: ["Chelsea Market for lunch and wandering, then up onto the High Line and north along the old rail line. Easy to cut short if the wind is up."],
      short: ["Check out, leave the bags, and take a slow morning at Chelsea Market with a walk on the High Line. Lunch, luggage, Penn Station, and the Crescent south."],
      photo: ["nyc/unit-chelsea-high-line.webp", "The High Line in winter"] },
    "theater-district": { title: "Broadway night",
      body: ["A show, tickets booked ahead, with Times Square as the walk before or after. Performance days vary by production, so the show gets booked first and the night lands where the ticket is."],
      photo: ["nyc/unit-theater-district.webp", "The Theater District after dark"] },
    "central-park": { title: "Central Park",
      body: ["A day in Central Park: the Mall, Bethesda Terrace, the lake, the Ramble, and Wollman Rink if anyone wants to skate. Easy to shorten. The park doesn't close."],
      short: ["Check out, leave the bags, and take a slow morning walk from the Plaza to Bethesda Terrace and back. Lunch, luggage, Penn Station, and the Crescent south."],
      photo: ["nyc/unit-central-park.webp", "Central Park in December"] },
    "metropolitan-museum": { title: "the Met",
      body: ["The Metropolitan Museum of Art, at whatever pace the family has: the Temple of Dendur, arms and armor, the American Wing, the Christmas tree in the Medieval Hall. Closed Wednesdays."],
      short: ["Check out, leave the bags, and give the morning to the Met's greatest hits. Lunch, luggage, Penn Station, and the Crescent south."],
      photo: ["nyc/unit-metropolitan-museum.webp", "The Great Hall at the Met"] },
    "top-of-the-rock": { title: "Top of the Rock",
      body: ["The observation deck at Rockefeller Center after dark: the Empire State Building one way, Central Park the other. Timed tickets. Wind closes the top deck."],
      photo: ["nyc/unit-top-of-the-rock.webp", "The view south from Top of the Rock"] },
    "amnh": { title: "Natural History",
      body: ["The American Museum of Natural History: the dinosaur halls, the blue whale, the Hall of Ocean Life, the planetarium. Timed entry. We stay until everyone has seen the thing they came for."],
      short: ["Check out, leave the bags, and give the morning to the dinosaurs and the whale. Lunch, luggage, Penn Station, and the Crescent south."],
      photo: ["nyc/unit-amnh.webp", "The blue whale in the Hall of Ocean Life"] },
    "grand-central": { title: "Grand Central",
      body: ["Grand Central Terminal: the main concourse, the ceiling, the whispering gallery, the market downstairs. About an hour, on the way to something else."],
      short: ["Check out, leave the bags, and spend an hour in Grand Central. Lunch, luggage, Penn Station, and the Crescent south."],
      photo: ["nyc/unit-grand-central.webp", "The main concourse at Grand Central"] },
    "ny-public-library": { title: "the Public Library",
      body: ["The Schwarzman Building on Fifth Avenue: the lions, the Rose Main Reading Room, whatever's on exhibit. An hour and a half, next door to Bryant Park."],
      short: ["Check out, leave the bags, and give an hour to the reading room. Lunch, luggage, Penn Station, and the Crescent south."],
      photo: ["nyc/unit-ny-public-library.webp", "The Rose Main Reading Room"] },
    "bryant-park": { title: "Bryant Park's Winter Village",
      body: ["Bryant Park after dark: the holiday shops, the rink, something warm to drink. The rink is free; the skates aren't."],
      photo: ["nyc/unit-bryant-park.webp", "The Winter Village at Bryant Park"] },
    "radio-city-christmas": { title: "the Christmas Spectacular",
      body: ["The Rockettes at Radio City Music Hall. About ninety minutes, tickets well ahead."],
      photo: ["nyc/unit-radio-city-christmas.webp", "Radio City Music Hall"] },
    "intrepid": { title: "the Intrepid",
      body: ["An aircraft carrier on the Hudson, with the space shuttle Enterprise on deck and a Concorde on the pier. The flight deck is outdoors, so dress for it."],
      short: ["Check out, leave the bags, and give the morning to the flight deck and the shuttle. Lunch, luggage, Penn Station, and the Crescent south."],
      photo: ["nyc/unit-intrepid.webp", "The Intrepid's flight deck"] },
    "moma": { title: "MoMA",
      body: ["The Museum of Modern Art: Starry Night, the Monet water lilies, the design galleries. Two to four hours, timed entry recommended."],
      short: ["Check out, leave the bags, and give the morning to MoMA's fifth floor. Lunch, luggage, Penn Station, and the Crescent south."],
      photo: ["nyc/unit-moma.webp", "The Museum of Modern Art"] },
    "one-world-observatory": { title: "One World Observatory",
      body: ["One hundred and two floors up at the World Trade Center. Timed tickets; about two hours with the elevators."],
      photo: ["nyc/unit-one-world-observatory.webp", "One World Trade Center"] },
    "empire-state-building": { title: "the Empire State Building",
      body: ["The observatory after dark. Timed tickets. The 86th floor is open-air, so wind counts."],
      photo: ["nyc/unit-empire-state-building.webp", "The Empire State Building at night"] },
    "macys-herald-square": { title: "Macy's at Christmas",
      body: ["Macy's Herald Square: the windows, the Santaland floor, the wooden escalators. An hour or two, a short walk from the hotel."],
      short: ["Check out, leave the bags, and give an hour to the windows and the Santaland floor. Lunch, luggage, Penn Station, and the Crescent south."],
      photo: ["nyc/unit-macys-herald-square.webp", "The windows at Macy's Herald Square"] },
    "greenwich-village": { title: "Greenwich Village",
      body: ["Washington Square, the side streets, and a long lunch. Not a museum."],
      photo: ["nyc/unit-greenwich-village.webp", "Washington Square Park"] },
    "chinatown-little-italy": { title: "Chinatown and Little Italy",
      body: ["Chinatown and Little Italy on foot: dumplings, Canal Street, cannoli on Mulberry Street. Two or three hours, mostly eating."],
      photo: ["nyc/unit-chinatown-little-italy.webp", "Mulberry Street"] },
    "st-patricks": { title: "St. Patrick's",
      body: ["St. Patrick's Cathedral, across Fifth Avenue from the tree. Half an hour by day."] },
  };

  /* The thirteen headline experiences the list tracks. */
  const headlines = ["rockefeller-christmas", "fifth-avenue-christmas", "central-park", "statue-liberty", "ellis-island", "metropolitan-museum", "broadway-show", "nine-eleven-museum", "nine-eleven-memorial", "top-of-the-rock", "amnh", "grand-central", "bryant-park"];

  /* Geography. Home base is Midtown near Penn Station, where the Crescent arrives.
     Manhattan is a grid too; straight-line miles decide walk or subway. */
  const base = { name: "the hotel", ll: [40.75, -73.991] };
  const WALK = 1.1;
  function distMi(a, b) {
    const R = 3958.8, toR = (x) => (x * Math.PI) / 180;
    const dLat = toR(b[0] - a[0]), dLon = toR(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a[0])) * Math.cos(toR(b[0])) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const geo = { base, WALK, distMi, ride: "subway" };

  const city = {
    id: "nyc", name: "New York", short: "NYC", title: ["New York,", "for Christmas."],
    station: "New York Penn Station", stationShort: "Penn Station", hotel: "Midtown, near Penn Station",
    lede: "in the city. Sleeper cars there and back. The tree at Rockefeller Center, the Met, the Statue of Liberty, a show, and a whole city dressed for Christmas.",
    reelIntro: "Everything New York has for us, and no schedule yet.",
    trainIntro: "No airport. No rental car. We board the Amtrak Crescent in Anniston after Bart gets off work, settle into two sleeper rooms across the hall from each other, sleep through Georgia and the Carolinas, and ride the corridor up from Washington. We roll into Penn Station in the evening, under Madison Square Garden, and walk to the hotel.",
    homeBase: "We're aiming for Midtown near Penn Station: a walk to Macy's, the Empire State Building, and Bryant Park, and one subway ride to almost everything else.",
    thesis: "Leave New York feeling like we actually saw New York, without needing a vacation from the vacation.",
    plate: { photo: "nyc/hero-rockefeller-night.webp", alt: "The tree at Rockefeller Center at night", title: "Rockefeller Center", sub: "lit for the night" },
    // The same train, four more hours. The Crescent's published times move by season; these are approximate
    // except the southbound departure, which the timetable prints as 2:15 PM.
    train: { boardLabel: "evening", arriveWeekend: "~6:30 PM, per the timetable", arriveWeekday: "evening, per the timetable", departLabel: "2:15 PM", homeLabel: "~10:30 AM CT", arriveHour: 18.5 },
    // The same seven nights are worth less here: an evening arrival, and a 2:15 PM train south that
    // leaves about two hours on the last morning between checkout and Penn Station.
    edges: { departureHours: 2 },
    narrative: {
      arrivalTitle: "Hello, New York.",
      arrivalBody: "Roll into Penn Station, up into Midtown, check into the hotel, unpack, eat. Then a first walk after dark: the Empire State Building is four blocks away and lit. No agenda. Just look up.",
      arrivalPhoto: ["nyc/day-arrival-penn-station.webp", "Moynihan Train Hall"],
      departureTail: "Lunch, luggage, Penn Station, and the Crescent south at 2:15.",
      lastMorning: "Check out, leave the bags with the hotel, a slow breakfast, and one last walk. Lunch, luggage, Penn Station, and the Crescent south at 2:15. Nothing big on purpose.",
    },
  };

  /* What makes this trip this trip. */
  const identity = {
    christmas: { name: "the tree at Rockefeller Center", any: ["rockefeller-christmas"] },
    icons: { name: "the Statue of Liberty or Central Park", any: ["statue-liberty", "central-park"] },
    museum: { name: "a major museum", any: ["metropolitan-museum", "amnh", "moma", "nine-eleven-museum"] },
    stage: { name: "a night at a show", any: ["broadway-show", "radio-city-christmas"] },
  };

  const catalog = { venues, bundles, pairings, preferred_order, structural, copy, headlines, geo, city, identity };
  if (typeof module !== "undefined" && module.exports) { module.exports = catalog; return; }
  root.DCVenuesNYC = catalog;
})(typeof window !== "undefined" ? window : globalThis);
