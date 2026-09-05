# Photo scavenger hunt

Drop each file into `public/img/` with the **exact filename** below and it appears on the site
automatically. Any slot without a file simply doesn't render, so add them in any order.

## Specs

- **WebP (lossy, quality ~80)**, landscape unless noted. Aim for **1600px wide** for day photos,
  **2160px** for the hero and train banner, and under ~400 KB each. Lossless WebP exports run
  3–4 MB apiece, so pick "lossy" when converting.
- Hero: **2400px wide**, at least 16:9, with the dome roughly centered.
- Day photos are cropped to 3:2 on the page; the train banner is cropped to 21:9.

## Where to look (and stay legal)

Federal government photos are public domain, so these are the safest sources:

- **National Park Service** galleries: nps.gov/nama (National Mall memorials), nps.gov/whho (White House / Ellipse / Christmas tree)
- **Architect of the Capitol**: aoc.gov (Capitol dome, night shots)
- **Library of Congress**: loc.gov/free-to-use and the Prints & Photographs collection (Great Hall)
- **Smithsonian Open Access**: si.edu/openaccess (Air & Space, Natural History, American History)
- **Arlington National Cemetery** on Flickr (U.S. Army, public domain)
- **Wikimedia Commons**: check each file's license; CC0 / public domain / CC-BY are fine
- **Amtrak**: their press photos are copyrighted. Use a Commons shot of the Crescent, or take your own in Anniston.

## The hunt

### Tier 1: the five that make the page

| # | Filename | Find this | Where it lands |
|---|---|---|---|
| 1 | `hero-capitol-night.webp` | U.S. Capitol dome lit up at night, wide, dark sky | Hero backdrop behind the headline |
| 2 | `train-crescent.webp` | The Amtrak Crescent, ideally a locomotive or the train at a platform at dusk | Wide banner in "The train is the trip" |
| 3 | `day-1202-lincoln-night.webp` | Lincoln Memorial after dark (or the Korean War statues under lights) | Wednesday, the big memorial night |
| 4 | `day-1205-national-christmas-tree.webp` | National Christmas Tree lit, White House behind it | Saturday, Christmas Washington |
| 5 | `family.webp` | The four of you. Square crop works best, faces centered | Footer, in a gold circle |

### Tier 2: one per day

| # | Filename | Find this | Where it lands |
|---|---|---|---|
| 6 | `day-1128-anniston-station.webp` | Anniston Amtrak station. Take it yourself at dusk if you can | Saturday Nov 28 |
| 7 | `day-1129-union-station.webp` | Union Station main hall, ideally with the holiday decorations up | Sunday Nov 29 |
| 8 | `day-1130-air-space.webp` | Air & Space: the Wright Flyer, Spirit of St. Louis, or an Apollo capsule | Monday Nov 30 |
| 9 | `day-1201-loc-great-hall.webp` | Library of Congress Great Hall, Jefferson Building | Tuesday Dec 1 |
| 10 | `day-1203-natural-history.webp` | The rotunda elephant, the T. rex, or the Hope Diamond | Thursday Dec 3 |
| 11 | `day-1204-arlington-guard.webp` | Changing of the Guard at the Tomb of the Unknown Soldier | Friday Dec 4 |
| 12 | `day-1206-american-history.webp` | American History Museum: the Star-Spangled Banner exhibit entrance or the building | Sunday Dec 6 |

### Tier 3: the fun ones

| # | Filename | Find this | Where it lands |
|---|---|---|---|
| 13 | `train-roomette.webp` | Inside a sleeper room with the beds folded down | Beside the train perks |
| 14 | `day-1207-home.webp` | Your front door, the couch, or the dog. Whatever "home" is | Monday Dec 7 |

## Captions

Captions live in the `<figcaption>` next to each image in `public/index.html`. Edit freely.
