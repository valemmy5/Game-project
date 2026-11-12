# SwiftBite: Delivery Rider Simulator

A web app that looks like a food delivery app's live tracking screen. A virtual rider brings food from a real, randomly chosen restaurant near you to your actual location.

## What it does

- **Uses your real location.** It asks the browser for your location. If you say no, you can type an address or use a demo location.
- **Picks a real restaurant nearby.** It queries OpenStreetMap (Overpass API) and prefers places 1.5–4 km away.
- **Rides real roads.** OSRM gives the road route. The rider's route differs between orders: it either uses one of OSRM's alternative routes or takes a random detour.
- **Runs in real time:** the restaurant accepts in 30 seconds, cooking takes up to 2 minutes while a rider heads to the restaurant, and the ride to you takes 10–15 minutes.
- **Clean tracking screen:** a mint header and a floating card with the arrival window, a segmented progress bar and the current status. Tap the status to see a timeline with times.
- **Light grey map:** a vector map (OpenFreeMap "Positron") showing only the route, the rider and your home pin. The map keeps the route in view and stops re-framing for 15 seconds after you pan or zoom.
- **Delivery and order details:** rider name, vehicle (bicycle, scooter or car) and rating, your address, and the order with prices.
- **Order help menu:** simulation speed (1×, 5×, 20×, pause), message or call the rider (pretend), or cancel and start a new order.
- **Survives reloads:** if you reload, lock your phone or switch apps, the order picks up where it should be.
- **Works without the network services.** If a service can't be reached, it uses a made-up restaurant, an approximate route or plain greyscale map tiles.

## Running it

It's a static site with no build step. Browsers only allow geolocation on `https://` or `localhost`:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

You can also host it on GitHub Pages: go to Settings → Pages, deploy from a branch, folder `/`.

Timings and the search radius are in the `CFG` object at the top of `app.js`.

## Credits

Map data © OpenStreetMap contributors · Map tiles by OpenFreeMap · Routing by OSRM · Geocoding by Nominatim · Map libraries: Leaflet and MapLibre GL.
