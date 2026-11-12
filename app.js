/* SwiftBite – simulated food delivery tracker
 * Map: Leaflet + MapLibre with the OpenFreeMap "positron" style (clean, light, no API key),
 *      falling back to greyscale OpenStreetMap tiles if WebGL/vector tiles are unavailable.
 * Data: Overpass API (real nearby restaurants), OSRM (real road routes), Nominatim (addresses).
 * Every network dependency has an offline fallback so the simulation always runs.
 */
(() => {
  'use strict';

  // ---------------------------------------------------------------- config
  // All timings are real seconds at 1× speed.
  const CFG = {
    restaurantRadius: 4500,
    preferredDist: [1500, 4000],  // restaurants this far away give a ~10–15 min ride
    minRestaurantDist: 600,
    riderStartDist: [400, 1000],  // rider is this close to the restaurant when assigned
    confirmSec: 30,               // restaurant accepts
    riderAssignSec: 10,           // after acceptance
    prepSec: [60, 120],           // cooking: 2 min max
    handoverSec: [30, 60],
    deliverySec: [600, 900],      // the ride to you: 10–15 min
    doorSec: 45,
    trafficFactor: [1.0, 1.2],
    detourChance: 0.65,
    demoLocation: { lat: 51.5079, lng: -0.0877, label: 'London Bridge, London' },
    netTimeoutMs: 12000,
  };

  const OSRM = 'https://router.project-osrm.org/route/v1/driving/';
  const OVERPASS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
  ];
  const NOMINATIM = 'https://nominatim.openstreetmap.org/';
  const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';

  // ---------------------------------------------------------------- helpers
  const $ = (id) => document.getElementById(id);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;

  function haversine(a, b) {
    const R = 6371000;
    const dLat = toRad(b[0] - a[0]);
    const dLng = toRad(b[1] - a[1]);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }
  function bearing(a, b) {
    const y = Math.sin(toRad(b[1] - a[1])) * Math.cos(toRad(b[0]));
    const x = Math.cos(toRad(a[0])) * Math.sin(toRad(b[0])) -
      Math.sin(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.cos(toRad(b[1] - a[1]));
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }
  function offsetPoint(origin, distM, bearingDeg) {
    const R = 6371000, d = distM / R, br = toRad(bearingDeg);
    const lat1 = toRad(origin[0]), lng1 = toRad(origin[1]);
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
    const lng2 = lng1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    return [toDeg(lat2), toDeg(lng2)];
  }
  function fmtDist(m) {
    if (m < 1000) return `${Math.round(m / 10) * 10} m`;
    return `${(m / 1000).toFixed(1)} km`;
  }
  const fmtClock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  /** "9:05–9:20 PM" (12h) or "21:05–21:20" (24h), whichever the phone uses. */
  function fmtRange(a, b) {
    const fa = fmtClock(a), fb = fmtClock(b);
    const re = /\s?([AaPp]\.?[Mm]\.?)$/;
    const ma = fa.match(re), mb = fb.match(re);
    return (ma && mb && ma[1] === mb[1] ? fa.replace(re, '') : fa) + '–' + fb;
  }
  const floor5 = (ms) => Math.floor(ms / 300000) * 300000;
  const ceil5 = (ms) => Math.ceil(ms / 300000) * 300000;

  async function fetchJSON(url, opts = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CFG.netTimeoutMs);
    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }
  const storage = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };

  // ---------------------------------------------------------------- icons
  const ICONS = {
    bicycle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="16" r="3.5"/><circle cx="18.5" cy="16" r="3.5"/><path d="M5.5 16L9 9h6.5l3 7M9 9l3 7H5.5M15.5 9L15 6h-2.5"/></svg>',
    scooter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="17" r="2.6"/><circle cx="18" cy="17" r="2.6"/><path d="M8.6 17h6.8l-2-9H16M3.5 13H10l2 4M13.4 8l-1-2"/></svg>',
    car: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16.5v-3.5l2.2-5h13.6l2.2 5v3.5z"/><circle cx="7" cy="17" r="1.8"/><circle cx="17" cy="17" r="1.8"/><path d="M4 13h16"/></svg>',
    restaurant: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3v8a2 2 0 0 0 2 2v8M9 3v8a2 2 0 0 1-2 2M7 3v6M17 21V3c-2 0-4 3-4 7 0 2 1 3 4 3"/></svg>',
  };
  const VEHICLE_LABEL = { bicycle: 'on a bicycle', scooter: 'on a scooter', car: 'in a car' };

  // ---------------------------------------------------------------- data
  const RIDERS = ['Yap', 'Maya', 'Jordan', 'Luis', 'Aisha', 'Kenji', 'Priya', 'Sam', 'Tomás', 'Grace', 'Andre', 'Nina', 'Omar', 'Chloe', 'Dev', 'Kwame', 'Sofia'];
  const RIDER_MSGS = [
    'Got your order, on my way now!',
    'Traffic is light, see you soon.',
    "I'll ring the bell when I'm outside.",
    'On my way, food is still hot.',
  ];
  const FAKE_NAMES = [
    'Golden Wok', "Luigi's Pizzeria", 'Burger Barn', 'Taco Fiesta', 'Sakura Sushi', 'Curry House',
    'The Green Bowl', 'Pho Saigon', 'Smokehouse BBQ', 'Mediterranean Grill', 'Bangkok Kitchen', 'The Daily Bagel',
  ];
  const MENUS = {
    pizza: [['Margherita Pizza', 12.5], ['Pepperoni Pizza', 14], ['Garlic Bread', 5], ['Caesar Salad', 8.5], ['Tiramisu', 6]],
    burger: [['Double Smash Burger', 12], ['Crispy Chicken Burger', 10.5], ['Fries', 3.5], ['Onion Rings', 4.5], ['Chocolate Shake', 5]],
    sushi: [['Spicy Tuna Roll', 8], ['Salmon Nigiri (4)', 9], ['Dragon Roll', 13], ['Miso Soup', 3], ['Edamame', 4.5]],
    japanese: [['Tonkotsu Ramen', 14], ['Chicken Katsu Curry', 13], ['Gyoza (6)', 6.5], ['Mochi', 4.5]],
    mexican: [['Carne Asada Tacos', 11], ['Chicken Burrito', 10.5], ['Chips & Guacamole', 5.5], ['Churros', 4.5]],
    chinese: [["General Tso's Chicken", 12], ['Beef Chow Mein', 11], ['Pork Dumplings', 7], ['Egg Fried Rice', 5], ['Hot & Sour Soup', 4.5]],
    indian: [['Chicken Tikka Masala', 13], ['Garlic Naan', 3.5], ['Vegetable Samosas', 5], ['Saag Paneer', 11], ['Mango Lassi', 4]],
    thai: [['Pad Thai', 12], ['Green Curry', 13], ['Spring Rolls', 5.5], ['Tom Yum Soup', 6.5]],
    vietnamese: [['Pho Bo', 12], ['Banh Mi', 8.5], ['Summer Rolls', 6], ['Vietnamese Iced Coffee', 4]],
    coffee: [['Oat Latte', 3.8], ['Cold Brew', 3.5], ['Almond Croissant', 3.5], ['Avocado Toast', 8.5]],
    chicken: [['Fried Chicken Bucket', 15], ['Spicy Wings (8)', 9], ['Mac & Cheese', 4.5], ['Coleslaw', 2.5]],
    sandwich: [['Club Sandwich', 9], ['Italian Sub', 10], ['Tomato Soup', 4.5], ['Cookie', 2]],
    mediterranean: [['Chicken Shawarma Wrap', 10], ['Falafel Plate', 11], ['Hummus & Pita', 6], ['Baklava', 4]],
    default: [["Chef's Special", 15], ['House Salad', 8], ['Grilled Chicken Bowl', 12], ['Fries', 3.5], ['Lemonade', 3]],
  };
  function menuFor(cuisine = '', name = '', amenity = '') {
    const s = `${cuisine} ${name}`.toLowerCase();
    const keys = [
      ['pizza', ['pizza', 'italian']], ['burger', ['burger', 'american', 'diner']], ['sushi', ['sushi']],
      ['japanese', ['japanese', 'ramen']], ['mexican', ['mexican', 'taco', 'burrito']],
      ['chinese', ['chinese', 'wok', 'dim sum', 'dumpling']], ['indian', ['indian', 'curry', 'nepal', 'pakistan']],
      ['thai', ['thai', 'bangkok']], ['vietnamese', ['vietnam', 'pho']], ['chicken', ['chicken', 'wings']],
      ['sandwich', ['sandwich', 'sub', 'deli', 'bagel']],
      ['mediterranean', ['mediterranean', 'greek', 'kebab', 'shawarma', 'falafel', 'lebanese', 'turkish']],
      ['burger', ['bbq', 'barbecue', 'smokehouse']], ['coffee', ['coffee', 'cafe', 'bakery']],
    ];
    for (const [k, words] of keys) if (words.some((w) => s.includes(w))) return MENUS[k];
    if (amenity === 'cafe') return MENUS.coffee;
    return MENUS.default;
  }

  // ---------------------------------------------------------------- map
  const map = L.map('map', { zoomControl: false, zoomSnap: 0.25, attributionControl: true }).setView([51.5, -0.1], 12);
  let rasterOn = false;
  function addBasemap() {
    let gl = null;
    let loaded = false;
    const fallback = () => {
      if (rasterOn || loaded) return;
      rasterOn = true;
      if (gl) map.removeLayer(gl);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
      $('map').classList.add('raster-fallback');
    };
    try {
      if (!window.maplibregl || !L.maplibreGL) throw new Error('MapLibre not loaded');
      gl = L.maplibreGL({
        style: MAP_STYLE,
        attribution: '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
      }).addTo(map);
      const glMap = gl.getMaplibreMap();
      glMap.on('load', () => { loaded = true; });
      glMap.on('error', () => fallback());
      setTimeout(fallback, 10000);
    } catch (e) {
      console.warn('Vector map unavailable, using raster tiles', e);
      fallback();
    }
  }
  addBasemap();

  const riderIcon = (vehicle) => L.divIcon({
    className: '', iconSize: [46, 46], iconAnchor: [23, 23],
    html: `<div class="rider-mk">${ICONS[vehicle]}</div>`,
  });
  const homeIcon = L.divIcon({
    className: '', iconSize: [60, 84], iconAnchor: [30, 77],
    html: `<div class="home-mk"><svg class="pin" viewBox="0 0 60 72">
      <path d="M30 71C24 59 4 49 4 28a26 26 0 1 1 52 0c0 21-20 31-26 43z" fill="#3b1d5a"/>
      <circle cx="30" cy="21" r="6.5" fill="none" stroke="#fff" stroke-width="3.2"/>
      <path d="M18 40c1.8-7 6.6-10.5 12-10.5S40.2 33 42 40" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/>
      </svg><div class="ring"></div></div>`,
  });
  const restIcon = L.divIcon({
    className: '', iconSize: [30, 30], iconAnchor: [15, 15],
    html: `<div class="rest-mk">${ICONS.restaurant}</div>`,
  });

  // ---------------------------------------------------------------- state
  let home = null;
  let order = null;
  let layers = [];
  let speed = Number(storage.get('swiftbite-speed-v3') || 1);
  let paused = false;
  let lastFrame = 0;
  let rafId = 0;
  let lastUserMove = 0;
  let orderToken = 0;
  const SAVE_DATA = 'swiftbite-order-data-v4';
  const SAVE_STATE = 'swiftbite-order-state-v4';

  // ---------------------------------------------------------------- small UI helpers
  let toastTimer = 0;
  function toast(msg, ms = 3500) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }
  function setText(id, text) {
    const el = $(id);
    if (el.textContent !== text) el.textContent = text;
  }
  function renderSpeedButtons() {
    document.querySelectorAll('.seg button[data-speed]').forEach((b) => {
      const v = Number(b.dataset.speed);
      b.classList.toggle('active', v === 0 ? paused : (!paused && v === speed));
    });
    $('pauseBtn').textContent = paused ? 'Resume' : 'Pause';
  }
  function vibrate(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch { /* ignore */ } }

  // ---------------------------------------------------------------- location
  function getBrowserLocation() {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) return reject(new Error('Geolocation unsupported'));
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        reject,
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
      );
    });
  }
  async function reverseGeocode(lat, lng) {
    try {
      const j = await fetchJSON(`${NOMINATIM}reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`);
      const a = j.address || {};
      const street = [a.house_number, a.road].filter(Boolean).join(' ');
      const city = a.city || a.town || a.village || a.suburb || a.county || '';
      return [street, city].filter(Boolean).join(', ') || j.display_name || null;
    } catch {
      return null;
    }
  }
  async function geocode(q) {
    const j = await fetchJSON(`${NOMINATIM}search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`);
    if (!j.length) throw new Error('Address not found');
    return { lat: Number(j[0].lat), lng: Number(j[0].lon), label: j[0].display_name.split(',').slice(0, 3).join(',') };
  }
  function showHomeLabel() {
    $('homeAddr').textContent = home.label || `${home.lat.toFixed(5)}, ${home.lng.toFixed(5)}`;
    if (!home.label) {
      const h = home;
      reverseGeocode(h.lat, h.lng).then((label) => {
        if (!label) return;
        h.label = label;
        if (home === h) $('homeAddr').textContent = label;
        if (order && order.data.home === h) storage.set(SAVE_DATA, JSON.stringify(order.data));
      });
    }
  }
  async function locate() {
    setText('statusText', 'Finding your location…');
    try {
      const pos = await getBrowserLocation();
      $('locModal').hidden = true;
      setHome(pos);
    } catch (e) {
      $('locModal').hidden = false;
      $('addrError').textContent = e && e.code === 1 ? 'Location permission was denied.' : '';
      setText('statusText', 'Where should we deliver?');
    }
  }
  function setHome(pos) {
    home = { lat: pos.lat, lng: pos.lng, label: pos.label || null };
    map.setView([home.lat, home.lng], 15);
    showHomeLabel();
    newOrder();
  }

  // ---------------------------------------------------------------- restaurants
  async function findRestaurant(center) {
    const [lat, lng] = center;
    const q = `[out:json][timeout:10];(
      node["amenity"~"^(restaurant|fast_food|cafe)$"]["name"](around:${CFG.restaurantRadius},${lat},${lng});
      way["amenity"~"^(restaurant|fast_food)$"]["name"](around:${CFG.restaurantRadius},${lat},${lng});
    );out center 200;`;
    try {
      const body = 'data=' + encodeURIComponent(q);
      const j = await Promise.any(OVERPASS.map((url) => fetchJSON(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      }).then((r) => { if (!r.elements) throw new Error('bad response'); return r; })));
      const places = (j.elements || [])
        .map((el) => {
          const p = el.type === 'node' ? [el.lat, el.lon] : el.center && [el.center.lat, el.center.lon];
          if (!p) return null;
          const t = el.tags || {};
          const addr = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
          return { pos: p, name: t.name, cuisine: t.cuisine || '', amenity: t.amenity, addr, dist: haversine(center, p) };
        })
        .filter((p) => p && p.dist >= CFG.minRestaurantDist);
      const preferred = places.filter((p) => p.dist >= CFG.preferredDist[0] && p.dist <= CFG.preferredDist[1]);
      if (preferred.length) return pick(preferred);
      if (places.length) return pick(places);
    } catch (e) {
      console.warn('Overpass failed, using a made-up restaurant', e);
    }
    const dist = rand(...CFG.preferredDist);
    return { pos: offsetPoint(center, dist, rand(0, 360)), name: pick(FAKE_NAMES), cuisine: '', amenity: 'restaurant', addr: '', dist };
  }

  // ---------------------------------------------------------------- routing
  async function osrmRoutes(points, alternatives) {
    const pts = points.map((p) => `${p[1].toFixed(6)},${p[0].toFixed(6)}`).join(';');
    const alt = alternatives ? '&alternatives=3' : '';
    const j = await fetchJSON(`${OSRM}${pts}?overview=full&geometries=geojson&annotations=duration${alt}`);
    if (j.code !== 'Ok' || !j.routes || !j.routes.length) throw new Error(j.code);
    return j.routes;
  }
  function buildRoute(r, traffic) {
    const coords = r.geometry.coordinates.map(([x, y]) => [y, x]);
    const durs = r.legs.flatMap((l) => (l.annotation && l.annotation.duration) || []);
    const times = [0];
    if (durs.length === coords.length - 1) {
      for (let i = 1; i < coords.length; i++) times.push(times[i - 1] + Math.max(durs[i - 1], 0.05) * traffic);
    } else {
      const seg = [];
      let tot = 0;
      for (let i = 1; i < coords.length; i++) { const d = haversine(coords[i - 1], coords[i]); seg.push(d); tot += d; }
      for (let i = 1; i < coords.length; i++) times.push(times[i - 1] + (seg[i - 1] / Math.max(tot, 1)) * r.duration * traffic);
    }
    return { coords, times, total: times[times.length - 1], dist: r.distance, real: true };
  }
  function straightRoute(from, to, traffic) {
    const n = 40;
    const coords = [];
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      const wig = Math.sin(f * Math.PI * 3) * 0.0006 * Math.sin(f * Math.PI);
      coords.push([from[0] + (to[0] - from[0]) * f + wig, from[1] + (to[1] - from[1]) * f - wig]);
    }
    const times = [0];
    let dist = 0;
    for (let i = 1; i < coords.length; i++) {
      const d = haversine(coords[i - 1], coords[i]) * 1.25;
      dist += d;
      times.push(times[i - 1] + d / (8.5 / traffic));
    }
    return { coords, times, total: times[times.length - 1], dist, real: false };
  }
  /** Real road route; varies between orders (OSRM alternatives or a random detour). */
  async function getRoute(from, to) {
    const traffic = rand(...CFG.trafficFactor);
    try {
      const routes = await osrmRoutes([from, to], true);
      let chosen = pick(routes);
      if (routes.length === 1 && Math.random() < CFG.detourChance) {
        try {
          const direct = haversine(from, to);
          const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
          const via = offsetPoint(mid, clamp(direct * rand(0.15, 0.3), 150, 700), bearing(from, to) + (Math.random() < 0.5 ? 90 : -90));
          const [v] = await osrmRoutes([from, via, to], false);
          if (v.duration < routes[0].duration * 1.4) chosen = v;
        } catch { /* keep direct route */ }
      }
      return buildRoute(chosen, traffic);
    } catch (e) {
      console.warn('OSRM failed, using a straight-line route', e);
      return straightRoute(from, to, traffic);
    }
  }
  /** Stretch/squeeze a route's timing so the ride takes `target` seconds. */
  function retime(route, target) {
    const k = target / Math.max(route.total, 1);
    route.times = route.times.map((t) => t * k);
    route.total = target;
    return route;
  }
  function positionAt(route, t) {
    const { coords, times } = route;
    if (t <= 0) return { pos: coords[0], idx: 0 };
    if (t >= route.total) return { pos: coords[coords.length - 1], idx: coords.length - 1 };
    let lo = 0, hi = times.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= t) lo = mid; else hi = mid;
    }
    const f = (t - times[lo]) / (times[hi] - times[lo] || 1);
    const a = coords[lo], b = coords[hi];
    return { pos: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], idx: lo };
  }
  function remainingDistance(route, idx, pos) {
    let d = haversine(pos, route.coords[Math.min(idx + 1, route.coords.length - 1)]);
    for (let i = idx + 1; i < route.coords.length - 1; i++) d += haversine(route.coords[i], route.coords[i + 1]);
    return d;
  }

  // ---------------------------------------------------------------- order lifecycle
  function clearLayers() {
    layers.forEach((l) => map.removeLayer(l));
    layers = [];
  }
  const addLayer = (l) => { layers.push(l); return l.addTo(map); };

  function resetUI() {
    $('doneModal').hidden = true;
    $('msgBtn').hidden = true;
    $('riderIcon').innerHTML = '';
    $('etaArt').innerHTML = '';
    setText('riderName', 'Finding a rider…');
    setText('riderSub', "We'll assign one shortly");
    setText('etaLabel', 'Estimated arrival');
    setText('etaTime', '--:--');
    $('items').innerHTML = '';
    setText('restName', 'Choosing a restaurant…');
    $('restAddr').innerHTML = '&nbsp;';
    $('timeline').innerHTML = '';
    document.querySelectorAll('.bar span').forEach((s) => { s.classList.remove('live'); s.firstElementChild.style.width = '0'; });
    document.querySelectorAll('#stars button').forEach((b) => b.classList.remove('on'));
  }

  async function newOrder() {
    if (!home) return;
    const token = ++orderToken;
    cancelAnimationFrame(rafId);
    order = null;
    storage.del(SAVE_DATA);
    storage.del(SAVE_STATE);
    clearLayers();
    resetUI();
    const homePt = [home.lat, home.lng];
    addLayer(L.marker(homePt, { icon: homeIcon, zIndexOffset: 500 }));
    setText('statusText', 'Placing your order…');

    const rest = await findRestaurant(homePt);
    if (token !== orderToken) return;
    setText('restName', rest.name);
    setText('statusText', `Sending your order to ${rest.name}…`);

    const T = {};
    T.confirmed = CFG.confirmSec;
    T.riderAssigned = T.confirmed + CFG.riderAssignSec;
    T.prepDone = T.confirmed + rand(...CFG.prepSec);

    const riderStart = offsetPoint(rest.pos, rand(...CFG.riderStartDist), rand(0, 360));
    const [toRest, toHome] = await Promise.all([getRoute(riderStart, rest.pos), getRoute(rest.pos, homePt)]);
    if (token !== orderToken) return;

    // Rider reaches the restaurant around when the food is ready; the ride to you takes 10–15 min.
    retime(toRest, clamp(T.prepDone - T.riderAssigned + rand(-20, 15), 40, 150));
    retime(toHome, clamp(toHome.total, ...CFG.deliverySec));
    T.riderAtRest = T.riderAssigned + toRest.total;
    T.pickedUp = Math.max(T.prepDone, T.riderAtRest) + rand(...CFG.handoverSec);
    T.atDoor = T.pickedUp + toHome.total;
    T.delivered = T.atDoor + CFG.doorSec;

    const vehicle = pick(['bicycle', 'bicycle', 'scooter', 'scooter', 'car']);
    const data = {
      no: Math.floor(100000 + Math.random() * 899999), placedAt: Date.now(), home, rest,
      itemsHtml: itemsHtml(menuFor(rest.cuisine, rest.name, rest.amenity)),
      rider: { name: pick(RIDERS), vehicle, rating: rand(4.8, 5).toFixed(1) },
      riderStart, toRest, toHome, T,
    };
    storage.set(SAVE_DATA, JSON.stringify(data));
    startOrder(data, 0, {});
    if (!toHome.real) toast('Routing service unavailable – showing an approximate route');
  }

  function startOrder(data, sim, flags) {
    cancelAnimationFrame(rafId);
    clearLayers();
    resetUI();
    const { rest, toHome, riderStart, rider } = data;
    const homePt = [data.home.lat, data.home.lng];
    addLayer(L.marker(homePt, { icon: homeIcon, zIndexOffset: 500 }));
    const restMarker = addLayer(L.marker(rest.pos, { icon: restIcon, zIndexOffset: 300 }).bindTooltip(rest.name, { direction: 'top', offset: [0, -14] }));
    const routeLine = addLayer(L.polyline(toHome.coords, { color: '#3dbdb0', weight: 5, opacity: 0.45, lineCap: 'round', lineJoin: 'round' }));
    const riderMarker = L.marker(riderStart, { icon: riderIcon(rider.vehicle), zIndexOffset: 1000 });

    setText('restName', rest.name);
    const cuisine = rest.cuisine ? rest.cuisine.split(';')[0].replace(/_/g, ' ') : '';
    setText('restAddr', [rest.addr, cuisine && cuisine[0].toUpperCase() + cuisine.slice(1), `${fmtDist(rest.dist)} away`].filter(Boolean).join(' · '));
    $('items').innerHTML = data.itemsHtml;
    $('etaArt').innerHTML = ICONS[rider.vehicle];

    order = {
      data, rest, rider, T: data.T, toRest: data.toRest, toHome, sim, flags,
      restMarker, routeLine, riderMarker, riderShown: false, riderPos: riderStart, routeIdx: 0,
      lastLine: 0, lastFit: 0, lastSave: 0, lastTimeline: 0,
    };
    lastUserMove = 0;
    fitMap(true);
    lastFrame = performance.now();
    rafId = requestAnimationFrame(tick);
  }

  function itemsHtml(menu) {
    const chosen = [...menu].sort(() => Math.random() - 0.5).slice(0, Math.floor(rand(2, 4.99)));
    let total = 0;
    const rows = chosen.map(([name, price]) => {
      const q = Math.random() < 0.25 ? 2 : 1;
      total += q * price;
      return `<div class="item"><span><span class="q">${q}×</span>${name}</span><span>£${(q * price).toFixed(2)}</span></div>`;
    });
    total += 2.49;
    rows.push('<div class="item"><span>Delivery fee</span><span>£2.49</span></div>');
    rows.push(`<div class="item total"><span>Total</span><span>£${total.toFixed(2)}</span></div>`);
    return rows.join('');
  }

  // ---------------------------------------------------------------- persistence
  function saveState() {
    if (!order || order.flags.delivered) return;
    storage.set(SAVE_STATE, JSON.stringify({ sim: order.sim, flags: order.flags, paused, savedAt: Date.now() }));
  }
  function tryResume() {
    let data, st;
    try {
      data = JSON.parse(storage.get(SAVE_DATA) || 'null');
      st = JSON.parse(storage.get(SAVE_STATE) || 'null') || { sim: 0, flags: {}, paused: false, savedAt: data && data.placedAt };
    } catch { return false; }
    if (!data || !data.T || !data.home) return false;
    if (Date.now() - data.placedAt > 3 * 3600 * 1000) { storage.del(SAVE_DATA); storage.del(SAVE_STATE); return false; }
    paused = !!st.paused;
    renderSpeedButtons();
    const away = paused ? 0 : ((Date.now() - st.savedAt) / 1000) * speed;
    const flags = { ...st.flags };
    delete flags.pickedUp; delete flags.door;
    home = data.home;
    showHomeLabel();
    startOrder(data, st.sim + away, flags);
    toast('Resuming your order');
    return true;
  }

  // ---------------------------------------------------------------- camera
  function fitMap(force) {
    const o = order;
    if (!o) return;
    if (!force && Date.now() - lastUserMove < 15000) return;
    const homePt = [o.data.home.lat, o.data.home.lng];
    const pts = [homePt];
    if (!o.flags.pickedUp) {
      pts.push(o.rest.pos);
      if (o.riderShown) pts.push(o.riderPos);
    } else {
      pts.push(o.riderPos);
      const c = o.toHome.coords;
      const step = Math.max(1, Math.floor((c.length - o.routeIdx) / 30));
      for (let i = o.routeIdx; i < c.length; i += step) pts.push(c[i]);
    }
    const mapRect = $('map').getBoundingClientRect();
    const cardRect = $('etaCard').getBoundingClientRect();
    const top = Math.max(40, cardRect.bottom - mapRect.top + 24);
    map.fitBounds(L.latLngBounds(pts), {
      paddingTopLeft: [60, top + 40], paddingBottomRight: [60, 40], maxZoom: 17, animate: !force, duration: 0.8,
    });
  }
  ['touchstart', 'mousedown', 'wheel'].forEach((ev) => $('map').addEventListener(ev, () => { lastUserMove = Date.now(); }, { passive: true }));

  // ---------------------------------------------------------------- render helpers
  function setBar(values, live) {
    document.querySelectorAll('.bar span').forEach((s, i) => {
      s.firstElementChild.style.width = `${clamp(values[i] || 0, 0, 1) * 100}%`;
      s.classList.toggle('live', i === live);
    });
  }
  function renderTimeline(t) {
    const o = order, T = o.T, at = (s) => fmtClock(o.data.placedAt + s * 1000);
    const steps = [
      ['Order placed', 0],
      [`Accepted by ${o.rest.name}`, T.confirmed],
      [`${o.rider.name} assigned as your rider`, T.riderAssigned],
      ['Food ready', T.prepDone],
      ['Picked up', T.pickedUp],
      ['Rider arrived', T.atDoor],
      ['Delivered', T.delivered],
    ];
    let html = '';
    let nowMarked = false;
    for (const [label, ts] of steps) {
      const done = t >= ts;
      let cls = done ? 'done' : '';
      if (!done && !nowMarked) { cls = 'now'; nowMarked = true; }
      html += `<li class="${cls}"><span class="dot"></span><span>${label}</span><span class="when">${done ? '' : '~'}${at(ts)}</span></li>`;
    }
    $('timeline').innerHTML = html;
  }
  function showRider() {
    const o = order;
    if (o.riderShown) return;
    o.riderShown = true;
    addLayer(o.riderMarker);
    $('riderIcon').innerHTML = ICONS[o.rider.vehicle];
    setText('riderName', o.rider.name);
    setText('riderSub', `Rider · ${VEHICLE_LABEL[o.rider.vehicle]} · ★ ${o.rider.rating}`);
    $('msgBtn').hidden = false;
  }
  function once(key, fn) {
    if (!order.flags[key]) { order.flags[key] = true; fn(); }
  }

  // ---------------------------------------------------------------- main loop
  function tick(now) {
    const o = order;
    if (!o) return;
    const dt = Math.max(0, (now - lastFrame) / 1000);
    lastFrame = now;
    if (!paused) o.sim += dt * speed;
    if (now - o.lastSave > 3000) { o.lastSave = now; saveState(); }
    const t = o.sim, T = o.T, r = o.rider.name;

    // ETA header
    const etaMs = o.data.placedAt + T.delivered * 1000;
    const left = T.delivered - t;
    if (t >= T.delivered) {
      setText('etaLabel', 'Delivered at');
      setText('etaTime', fmtClock(etaMs));
    } else if (t >= T.atDoor) {
      setText('etaLabel', 'Estimated arrival');
      setText('etaTime', 'Now');
    } else if (left <= 300) {
      setText('etaLabel', 'Arriving in');
      setText('etaTime', `${Math.max(1, Math.ceil((T.atDoor - t) / 60))} min`);
    } else {
      setText('etaLabel', 'Estimated arrival');
      setText('etaTime', fmtRange(floor5(etaMs - 240000), ceil5(etaMs + 240000)));
    }

    // Rider heading to the restaurant
    if (t >= T.riderAssigned) showRider();
    if (t >= T.riderAssigned && t < T.pickedUp) {
      o.riderPos = positionAt(o.toRest, t - T.riderAssigned).pos;
      o.riderMarker.setLatLng(o.riderPos);
    }

    const drive = T.atDoor - T.pickedUp;
    if (t < T.confirmed) {
      setText('statusText', `Waiting for ${o.rest.name} to accept your order`);
      setBar([t / T.confirmed], 0);
    } else if (t < T.pickedUp) {
      setBar([1, (t - T.confirmed) / (T.pickedUp - T.confirmed)], 1);
      if (t >= T.riderAtRest && t >= T.prepDone) setText('statusText', `${r} is collecting your order`);
      else if (t >= T.riderAtRest) setText('statusText', `${r} is waiting at the restaurant`);
      else if (t >= T.prepDone) setText('statusText', `Your food is ready, ${r} is nearly there`);
      else setText('statusText', `${o.rest.name} is preparing your order`);
    } else if (t < T.atDoor) {
      once('pickedUp', () => {
        map.removeLayer(o.restMarker);
        o.routeLine.setStyle({ opacity: 1 });
        fitMap(true);
      });
      const dtHome = t - T.pickedUp;
      const p = positionAt(o.toHome, dtHome);
      o.riderPos = p.pos;
      o.routeIdx = p.idx;
      o.riderMarker.setLatLng(p.pos);
      const f = dtHome / drive;
      setBar([1, 1, f / 0.8, ((f - 0.8) / 0.2) * 0.6], f < 0.8 ? 2 : 3);
      const distLeft = remainingDistance(o.toHome, p.idx, p.pos);
      if (distLeft < 300) {
        setText('statusText', `${r} is almost there`);
        once('near', () => { toast(`${r} is nearby – get ready!`); vibrate([120, 60, 120]); });
      } else {
        setText('statusText', 'Your order is on the way');
      }
      if (now - o.lastLine > 150) {
        o.lastLine = now;
        o.routeLine.setLatLngs([p.pos, ...o.toHome.coords.slice(p.idx + 1)]);
      }
    } else if (t < T.delivered) {
      once('door', () => {
        map.removeLayer(o.restMarker);
        o.riderPos = o.toHome.coords[o.toHome.coords.length - 1];
        o.riderMarker.setLatLng(o.riderPos);
        o.routeLine.setLatLngs([]);
        toast(`${r} has arrived with your order`);
        vibrate([200, 100, 200]);
        fitMap(true);
      });
      setText('statusText', `${r} has arrived – meet them at the door`);
      setBar([1, 1, 1, 0.6 + (0.4 * (t - T.atDoor)) / (T.delivered - T.atDoor)], 3);
    } else {
      once('delivered', () => {
        setBar([1, 1, 1, 1, 1], -1);
        setText('etaLabel', 'Delivered at');
        setText('etaTime', fmtClock(etaMs));
        setText('statusText', 'Order delivered. Enjoy your meal!');
        setText('doneText', `${r} delivered your order from ${o.rest.name} in ${Math.round(T.delivered / 60)} minutes. How was it?`);
        renderTimeline(t);
        $('doneModal').hidden = false;
        storage.del(SAVE_DATA);
        storage.del(SAVE_STATE);
      });
      return;
    }

    if (now - o.lastTimeline > 1000) { o.lastTimeline = now; renderTimeline(t); }
    if (now - o.lastFit > 5000) { o.lastFit = now; fitMap(false); }
    rafId = requestAnimationFrame(tick);
  }

  // ---------------------------------------------------------------- events
  $('statusToggle').addEventListener('click', () => {
    const open = $('timeline').hidden;
    $('timeline').hidden = !open;
    $('statusToggle').setAttribute('aria-expanded', String(open));
  });

  const openHelp = () => { $('helpSheet').hidden = false; };
  const closeHelp = () => { $('helpSheet').hidden = true; };
  $('helpBtn').addEventListener('click', openHelp);
  $('helpClose').addEventListener('click', closeHelp);
  $('helpSheet').addEventListener('click', (e) => { if (e.target === $('helpSheet')) closeHelp(); });

  document.querySelectorAll('.seg button[data-speed]').forEach((b) => {
    b.addEventListener('click', () => {
      const v = Number(b.dataset.speed);
      if (v === 0) paused = !paused;
      else { speed = v; paused = false; storage.set('swiftbite-speed-v3', String(v)); }
      renderSpeedButtons();
      saveState();
    });
  });
  document.addEventListener('visibilitychange', saveState);
  window.addEventListener('pagehide', saveState);

  const riderMsg = () => {
    if (!order || !order.riderShown) return toast('No rider assigned yet');
    toast(`${order.rider.name}: "${pick(RIDER_MSGS)}"`, 4500);
  };
  $('msgBtn').addEventListener('click', riderMsg);
  $('helpMsg').addEventListener('click', () => { closeHelp(); riderMsg(); });
  $('helpCall').addEventListener('click', () => {
    closeHelp();
    if (!order || !order.riderShown) return toast('No rider assigned yet');
    toast(`Calling ${order.rider.name}… (it's a simulation, they can't hear you)`);
  });
  const cancelAndNew = () => {
    if (!home) return;
    if (order && !order.flags.delivered && !confirm('Cancel this order and start a new one?')) return;
    closeHelp();
    newOrder();
  };
  $('helpNew').addEventListener('click', cancelAndNew);
  $('closeBtn').addEventListener('click', cancelAndNew);
  $('againBtn').addEventListener('click', () => newOrder());
  $('doneClose').addEventListener('click', () => { $('doneModal').hidden = true; });

  document.querySelectorAll('#stars button').forEach((b) => {
    b.addEventListener('click', () => {
      const v = Number(b.dataset.v);
      document.querySelectorAll('#stars button').forEach((s) => s.classList.toggle('on', Number(s.dataset.v) <= v));
    });
  });

  $('addrForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('addrInput').value.trim();
    if (!q) return;
    $('addrError').textContent = 'Searching…';
    try {
      const loc = await geocode(q);
      $('locModal').hidden = true;
      $('addrError').textContent = '';
      setHome(loc);
    } catch {
      $('addrError').textContent = "Couldn't find that address. Try adding a city.";
    }
  });
  $('retryGeo').addEventListener('click', () => { $('locModal').hidden = true; locate(); });
  $('demoLoc').addEventListener('click', () => { $('locModal').hidden = true; setHome(CFG.demoLocation); });

  // ---------------------------------------------------------------- boot
  renderSpeedButtons();
  if (!tryResume()) locate();
})();
