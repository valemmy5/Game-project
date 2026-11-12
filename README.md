# SwiftBite — Delivery Driver Simulator

A web app that looks like a food delivery app's live tracking screen. A virtual driver brings food from a real, randomly chosen restaurant near you to your actual location.

## What it does

- **Uses your real location.** It asks the browser for your location. If you say no, you can type an address or use a demo location.
- **Picks a real restaurant nearby.** It queries OpenStreetMap (Overpass API) for restaurants, fast food places and cafés within about 3.5 km and picks one at random.
- **Drives real roads.** OSRM gives the road route and per-segment travel times, so the driver slows down where the roads are slower. Turn-by-turn hints update as the driver goes.
- **Follows a delivery timeline:** order confirmed → driver assigned and heading to the restaurant → food being prepared → pickup → on the way → at your door → delivered.
- **Has a delivery-app UI:** ETA countdown and arrival window, progress bar, driver card (name, rating, car, plate), a generated order with prices, toast notifications, a fake message/call button and a rating screen.
- **Real-time by default:** an order takes about 20–25 minutes, including 9–14 minutes of cooking. Speed it up with 10× or 30×, or pause. If you reload or close the page, the order picks up where it should be. The map follows the driver; drag the map to stop following, and tap the arrow button to follow again.
- **Works without the network services.** If a service can't be reached, it makes up a restaurant and uses an approximate route, so the simulation still runs.

## Running it

It's a static site with no build step. Browsers only allow geolocation on `https://` or `localhost`, so serve it locally:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Or host it on **GitHub Pages**: go to Settings → Pages, choose to deploy from this branch, folder `/`. You can then open it on your phone.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Layout: map, top bar, bottom sheet, modals |
| `style.css` | Mobile-first app styling; on wide screens the sheet becomes a side panel |
| `app.js` | Location, restaurant search, routing, timeline simulation and animation |

Tweak timings (prep time, search radius, and so on) in the `CFG` object at the top of `app.js`.

## Credits

Map data & tiles © OpenStreetMap contributors · Routing by OSRM · Geocoding by Nominatim · Map library: Leaflet.
