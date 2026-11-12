/* SwiftBite – simulated food delivery tracker
 * Uses: Leaflet (map), CARTO tiles, Overpass API (real nearby restaurants),
 * OSRM (real road routing), Nominatim (address lookup).
 * Every network dependency has an offline fallback so the simulation always runs.
 */
(() => {
  'use strict';

  // ---------------------------------------------------------------- config
  const CFG = {
    restaurantRadius: 3500,   // metres to search for restaurants around you
    minRestaurantDist: 600,   // don't pick one right next door
    driverStartDist: [900, 2200],
    confirmSec: 30,
    prepSec: [240, 480],
    pickupWaitSec: 75,
    doorSec: 45,
    trafficFactor: [1.1, 1.35],
    demoLocation: { lat: 40.7411, lng: -73.9897, label: 'Flatiron, New York, NY' },
    netTimeoutMs: 12000,
  };

  const OSRM = 'https://router.project-osrm.org/route/v1/driving/';
  // Public Overpass servers are sometimes slow; we query several and take the first answer.
  const OVERPASS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
  ];
  const NOMINATIM = 'https://nominatim.openstreetmap.org/';

  // ---------------------------------------------------------------- helpers
  const $ = (id) => document.getElementById(id);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
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
    if (m < 160) return `${Math.round(m / 10) * 10} m`;
    return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
  }
  function fmtClock(date) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
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
  };

  // ---------------------------------------------------------------- data
  const DRIVERS = [
    ['Maya', '👩🏽'], ['Jordan', '🧑🏻'], ['Luis', '👨🏽'], ['Aisha', '👩🏾'], ['Kenji', '👨🏻'],
    ['Priya', '👩🏽'], ['Sam', '🧑🏼'], ['Tomás', '👨🏻'], ['Grace', '👩🏻'], ['Andre', '👨🏿'],
    ['Nina', '👩🏼'], ['Omar', '👨🏾'], ['Chloe', '👩🏻'], ['Dev', '🧑🏽'],
  ];
  const VEHICLES = [
    'Silver Toyota Prius', 'Blue Honda Civic', 'White Tesla Model 3', 'Black Hyundai Elantra',
    'Red Mazda 3', 'Grey Kia Soul', 'Green Subaru Crosstrek', 'White Ford Escape',
  ];
  const DRIVER_MSGS = [
    "Got your order! Heading your way now 🚗",
    "Traffic's light, should be there soon!",
    "I'll leave it at the door if you're busy 👍",
    "On my way — food's still hot 🔥",
  ];
  const FAKE_NAMES = [
    'Golden Wok', 'Luigi\'s Pizzeria', 'Burger Barn', 'Taco Fiesta', 'Sakura Sushi', 'Curry House',
    'The Green Bowl', 'Pho Saigon', 'Smokehouse BBQ', 'Mediterranean Grill', 'Bangkok Kitchen', 'The Daily Bagel',
  ];

  const MENUS = {
    pizza: { emoji: '🍕', items: [['Margherita Pizza', 14.5], ['Pepperoni Pizza', 16], ['Garlic Knots', 6], ['Caesar Salad', 9.5], ['Tiramisu', 7]] },
    burger: { emoji: '🍔', items: [['Double Smash Burger', 13], ['Crispy Chicken Sandwich', 11.5], ['Large Fries', 4.5], ['Onion Rings', 5], ['Chocolate Shake', 6]] },
    sushi: { emoji: '🍣', items: [['Spicy Tuna Roll', 9], ['Salmon Nigiri (4pc)', 10], ['Dragon Roll', 15], ['Miso Soup', 3.5], ['Edamame', 5]] },
    japanese: { emoji: '🍜', items: [['Tonkotsu Ramen', 16], ['Chicken Katsu Curry', 15], ['Gyoza (6pc)', 7], ['Matcha Mochi', 5]] },
    mexican: { emoji: '🌮', items: [['Carne Asada Tacos', 12], ['Chicken Burrito', 11.5], ['Chips & Guacamole', 6.5], ['Horchata', 3.5], ['Churros', 5]] },
    chinese: { emoji: '🥡', items: [['General Tso\'s Chicken', 14], ['Beef Lo Mein', 13], ['Pork Dumplings', 8], ['Egg Fried Rice', 9], ['Hot & Sour Soup', 5]] },
    indian: { emoji: '🍛', items: [['Chicken Tikka Masala', 16], ['Garlic Naan', 4], ['Vegetable Samosas', 6], ['Saag Paneer', 14], ['Mango Lassi', 4.5]] },
    thai: { emoji: '🍲', items: [['Pad Thai', 14], ['Green Curry', 15], ['Spring Rolls', 6], ['Tom Yum Soup', 7], ['Thai Iced Tea', 4]] },
    vietnamese: { emoji: '🍜', items: [['Pho Tai', 14], ['Banh Mi', 10], ['Fresh Rolls', 7], ['Vietnamese Coffee', 5]] },
    coffee: { emoji: '☕', items: [['Oat Latte', 5.5], ['Cold Brew', 4.5], ['Almond Croissant', 4.5], ['Avocado Toast', 9.5]] },
    chicken: { emoji: '🍗', items: [['8pc Fried Chicken', 18], ['Spicy Wings (10)', 13], ['Mac & Cheese', 5], ['Coleslaw', 3.5]] },
    sandwich: { emoji: '🥪', items: [['Turkey Club', 11], ['Italian Sub', 12], ['Tomato Soup', 5], ['Cookie', 2.5]] },
    mediterranean: { emoji: '🥙', items: [['Chicken Shawarma Plate', 15], ['Falafel Wrap', 11], ['Hummus & Pita', 7], ['Baklava', 5]] },
    default: { emoji: '🍽️', items: [['Chef\'s Special', 17], ['House Salad', 9], ['Grilled Chicken Bowl', 14], ['Fries', 4.5], ['Lemonade', 3.5]] },
  };
  function menuFor(cuisine = '', name = '', amenity = '') {
    const s = `${cuisine} ${name}`.toLowerCase();
    const keys = [
      ['pizza', ['pizza', 'italian']], ['burger', ['burger', 'american', 'diner']], ['sushi', ['sushi']],
      ['japanese', ['japanese', 'ramen']], ['mexican', ['mexican', 'taco', 'burrito', 'tex-mex']],
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
  const map = L.map('map', { zoomControl: false, attributionControl: true }).setView([39.5, -98.35], 4);
  // Standard OpenStreetMap tiles: free, no API key needed.
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  const pinIcon = (emoji, cls = '') => L.divIcon({
    className: '', iconSize: [44, 52], iconAnchor: [22, 52],
    html: `<div class="pin ${cls}"><div class="bubble">${emoji}</div></div>`,
  });
  const driverIcon = L.divIcon({
    className: '', iconSize: [48, 48], iconAnchor: [24, 24],
    html: `<div class="driver-marker"><div class="pulse"></div><div class="dot">
      <svg class="arrow" viewBox="0 0 24 24"><path d="M12 2l7 19-7-4-7 4z" fill="currentColor"/></svg></div></div>`,
  });

  // ---------------------------------------------------------------- state
  let home = null;            // { lat, lng, label }
  let order = null;           // current order (see newOrder)
  let layers = [];
  let speed = Number(storage.get('swiftbite-speed') || 10);
  let paused = false;
  let follow = true;
  let lastFrame = 0;
  let rafId = 0;

  // ---------------------------------------------------------------- UI bits
  let toastTimer = 0;
  function toast(msg, ms = 3200) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }
  function setStatus(title, sub) {
    if ($('statusTitle').textContent !== title) $('statusTitle').textContent = title;
    if ($('statusSub').textContent !== sub) $('statusSub').textContent = sub;
  }
  function setSheetHeightVar() {
    const sheet = $('sheet');
    const visible = sheet.classList.contains('collapsed') ? 150 : sheet.offsetHeight;
    document.documentElement.style.setProperty('--sheet-h', `${visible}px`);
  }
  function mapPadding() {
    if (window.innerWidth >= 860) return { paddingTopLeft: [440, 40], paddingBottomRight: [40, 40] };
    return { paddingTopLeft: [30, 90], paddingBottomRight: [30, Math.min($('sheet').offsetHeight, window.innerHeight * 0.6) + 20] };
  }

  /** Map centre that puts `pos` in the middle of the area not covered by the panel/sheet. */
  function visibleCenter(pos, zoom = map.getZoom()) {
    const pt = map.project(pos, zoom);
    const shift = window.innerWidth >= 860
      ? L.point(-216, 0)
      : L.point(0, Math.min($('sheet').offsetHeight, window.innerHeight * 0.6) / 2 - 30);
    return map.unproject(pt.add(shift), zoom);
  }

  function renderSpeedButtons() {
    document.querySelectorAll('.speed button[data-speed]').forEach((b) => {
      const v = Number(b.dataset.speed);
      b.classList.toggle('active', v === 0 ? paused : (!paused && v === speed));
    });
    $('pauseBtn').textContent = paused ? '▶' : '❚❚';
    $('pauseBtn').setAttribute('aria-label', paused ? 'Resume' : 'Pause');
  }

  // ---------------------------------------------------------------- location
  function getBrowserLocation() {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) return reject(new Error('Geolocation unsupported'));
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        (e) => reject(e),
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

  async function locate() {
    setStatus('Finding your location…', 'Allow location access so we can deliver to you.');
    try {
      const pos = await getBrowserLocation();
      $('locModal').hidden = true;
      await setHome(pos);
    } catch (e) {
      $('locModal').hidden = false;
      $('addrError').textContent = e && e.code === 1 ? 'Location permission was denied.' : '';
      setStatus('Where should we deliver?', 'Enter an address to start your order.');
    }
  }

  async function setHome(pos) {
    home = { lat: pos.lat, lng: pos.lng, label: pos.label || null };
    $('homeAddr').textContent = home.label || `${home.lat.toFixed(5)}, ${home.lng.toFixed(5)}`;
    map.setView([home.lat, home.lng], 15);
    if (!home.label) {
      reverseGeocode(home.lat, home.lng).then((label) => {
        if (label) { home.label = label; $('homeAddr').textContent = label; }
      });
    }
    newOrder();
  }

  // ---------------------------------------------------------------- restaurants
  async function findRestaurant(center) {
    const [lat, lng] = center;
    const q = `[out:json][timeout:10];(
      node["amenity"~"^(restaurant|fast_food|cafe)$"]["name"](around:${CFG.restaurantRadius},${lat},${lng});
      way["amenity"~"^(restaurant|fast_food)$"]["name"](around:${CFG.restaurantRadius},${lat},${lng});
    );out center 120;`;
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
      if (places.length) return { ...pick(places), real: true };
    } catch (e) {
      console.warn('Overpass failed, using a made-up restaurant', e);
    }
    const dist = rand(1200, 3000);
    const pos = offsetPoint(center, dist, rand(0, 360));
    const name = pick(FAKE_NAMES);
    return { pos, name, cuisine: '', amenity: 'restaurant', addr: '', dist, real: false };
  }

  // ---------------------------------------------------------------- routing
  function maneuverText(step) {
    const m = step.maneuver || {};
    const road = step.name ? ` onto ${step.name}` : '';
    const mod = m.modifier || '';
    switch (m.type) {
      case 'depart': return `Heading ${compass(m.bearing_after)}${step.name ? ` on ${step.name}` : ''}`;
      case 'arrive': return 'Arriving at destination';
      case 'roundabout': case 'rotary': return `Take the roundabout${road}`;
      case 'merge': return `Merge${road}`;
      case 'on ramp': return `Take the ramp${road}`;
      case 'off ramp': return `Take the exit${road}`;
      case 'fork': return `Keep ${mod.includes('left') ? 'left' : 'right'}${road}`;
      case 'end of road': case 'turn': case 'new name': case 'continue': default:
        if (mod === 'uturn') return `Make a U-turn${road}`;
        if (mod === 'straight' || !mod) return `Continue${step.name ? ` on ${step.name}` : ' straight'}`;
        return `Turn ${mod}${road}`;
    }
  }
  function maneuverArrow(step) {
    const mod = (step.maneuver && step.maneuver.modifier) || '';
    if (step.maneuver && step.maneuver.type === 'arrive') return '📍';
    if (mod === 'uturn') return '↩';
    if (mod.includes('sharp left') || mod === 'left') return '←';
    if (mod.includes('sharp right') || mod === 'right') return '→';
    if (mod.includes('slight left')) return '↖';
    if (mod.includes('slight right')) return '↗';
    return '↑';
  }
  function compass(deg = 0) {
    return ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(deg / 45) % 8];
  }

  /** Returns { coords: [[lat,lng]], times: cumulative seconds, total, dist, steps: [{t, text, arrow}] } */
  async function getRoute(from, to) {
    const traffic = rand(...CFG.trafficFactor);
    try {
      const url = `${OSRM}${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson&steps=true&annotations=duration,distance`;
      const j = await fetchJSON(url);
      if (j.code !== 'Ok' || !j.routes.length) throw new Error(j.code);
      const r = j.routes[0];
      const leg = r.legs[0];
      const coords = r.geometry.coordinates.map(([x, y]) => [y, x]);
      const durs = leg.annotation && leg.annotation.duration;
      const times = [0];
      for (let i = 1; i < coords.length; i++) {
        const d = durs && durs[i - 1] != null ? durs[i - 1] : haversine(coords[i - 1], coords[i]) / 8;
        times.push(times[i - 1] + Math.max(d, 0.05) * traffic);
      }
      let acc = 0;
      const steps = leg.steps.map((s) => {
        const step = { t: acc * traffic, text: maneuverText(s), arrow: maneuverArrow(s) };
        acc += s.duration;
        return step;
      });
      // Rescale step times to match annotation total exactly.
      const scale = times[times.length - 1] / Math.max(acc * traffic, 1);
      steps.forEach((s) => { s.t *= scale; });
      return { coords, times, total: times[times.length - 1], dist: r.distance, steps, real: true };
    } catch (e) {
      console.warn('OSRM failed, using a straight-line route', e);
      return straightRoute(from, to, traffic);
    }
  }
  function straightRoute(from, to, traffic) {
    const n = 40;
    const coords = [];
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      // gentle wiggle so it doesn't look perfectly straight
      const wig = Math.sin(f * Math.PI * 3) * 0.0006 * Math.sin(f * Math.PI);
      coords.push([from[0] + (to[0] - from[0]) * f + wig, from[1] + (to[1] - from[1]) * f - wig]);
    }
    const speedMs = 8.5 / traffic; // ~30 km/h city speed
    const times = [0];
    let dist = 0;
    for (let i = 1; i < coords.length; i++) {
      const d = haversine(coords[i - 1], coords[i]) * 1.25;
      dist += d;
      times.push(times[i - 1] + d / speedMs);
    }
    const steps = [{ t: 0, text: `Heading ${compass(bearing(from, to))}`, arrow: '↑' }];
    return { coords, times, total: times[times.length - 1], dist, steps, real: false };
  }

  /** Position along a route at time t (seconds since departure). */
  function positionAt(route, t) {
    const { coords, times } = route;
    if (t <= 0) return { pos: coords[0], idx: 0, heading: bearing(coords[0], coords[Math.min(1, coords.length - 1)]) };
    if (t >= route.total) {
      const n = coords.length;
      return { pos: coords[n - 1], idx: n - 1, heading: bearing(coords[Math.max(0, n - 2)], coords[n - 1]) };
    }
    let lo = 0, hi = times.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= t) lo = mid; else hi = mid;
    }
    const f = (t - times[lo]) / (times[hi] - times[lo] || 1);
    const a = coords[lo], b = coords[hi];
    return { pos: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], idx: lo, heading: bearing(a, b) };
  }
  function remainingDistance(route, idx, pos) {
    let d = haversine(pos, route.coords[Math.min(idx + 1, route.coords.length - 1)]);
    for (let i = idx + 1; i < route.coords.length - 1; i++) d += haversine(route.coords[i], route.coords[i + 1]);
    return d;
  }
  function stepAt(route, t) {
    let cur = route.steps[0], next = null;
    for (let i = 0; i < route.steps.length; i++) {
      if (route.steps[i].t <= t) { cur = route.steps[i]; next = route.steps[i + 1] || null; }
    }
    return { cur, next };
  }

  // ---------------------------------------------------------------- order lifecycle
  function clearLayers() {
    layers.forEach((l) => map.removeLayer(l));
    layers = [];
  }
  function addLayer(l) { layers.push(l); return l.addTo(map); }

  function resetUI() {
    $('driverCard').hidden = true;
    $('navHint').hidden = true;
    $('doneModal').hidden = true;
    $('etaPill').classList.remove('done');
    $('etaMin').textContent = '--';
    $('items').innerHTML = '';
    $('restName').textContent = 'Choosing a restaurant…';
    $('restAddr').innerHTML = '&nbsp;';
    $('restIcon').textContent = '🍽️';
    document.querySelectorAll('.seg').forEach((s) => { s.classList.remove('active'); s.firstElementChild.style.width = '0'; });
    document.querySelectorAll('#stars button').forEach((b) => b.classList.remove('on'));
  }

  async function newOrder() {
    if (!home) return;
    cancelAnimationFrame(rafId);
    order = null;
    clearLayers();
    resetUI();
    const orderNo = Math.floor(100000 + Math.random() * 899999);
    $('orderId').textContent = `Order #${orderNo}`;

    const homePt = [home.lat, home.lng];
    addLayer(L.marker(homePt, { icon: pinIcon('🏠', 'home'), zIndexOffset: 500 }));
    setStatus('Placing your order…', 'Finding a restaurant near you');

    const rest = await findRestaurant(homePt);
    const menu = menuFor(rest.cuisine, rest.name, rest.amenity);
    $('restName').textContent = rest.name;
    $('restIcon').textContent = menu.emoji;
    const cuisineLabel = rest.cuisine ? rest.cuisine.split(';')[0].replace(/_/g, ' ') : '';
    $('restAddr').textContent = [rest.addr, cuisineLabel, `${fmtDist(rest.dist)} away`].filter(Boolean).join(' · ');
    addLayer(L.marker(rest.pos, { icon: pinIcon(menu.emoji), zIndexOffset: 400 })
      .bindTooltip(rest.name, { direction: 'top', offset: [0, -50] }));

    renderItems(menu);
    setStatus('Placing your order…', `Sending your order to ${rest.name}`);

    // Driver starts somewhere near the restaurant and drives there first.
    const driverStart = offsetPoint(rest.pos, rand(...CFG.driverStartDist), rand(0, 360));
    const [toRest, toHome] = await Promise.all([getRoute(driverStart, rest.pos), getRoute(rest.pos, homePt)]);

    const [driverName, avatar] = pick(DRIVERS);
    const driver = {
      name: driverName, avatar,
      car: `${pick(VEHICLES)} · ${plate()}`,
      rating: rand(4.82, 5).toFixed(2),
    };

    // ---- timeline (simulated seconds)
    const T = {};
    T.confirmed = CFG.confirmSec;
    T.prepDone = T.confirmed + rand(...CFG.prepSec);
    T.driverAtRest = T.confirmed + 20 + toRest.total;           // driver accepted 20s after confirm
    T.pickedUp = Math.max(T.prepDone, T.driverAtRest) + CFG.pickupWaitSec;
    T.atDoor = T.pickedUp + toHome.total;
    T.delivered = T.atDoor + CFG.doorSec;

    // ---- map layers
    const restLine = addLayer(L.polyline(toRest.coords, { color: '#9aa1ad', weight: 4, opacity: 0.8, dashArray: '2 8', lineCap: 'round' }));
    const homeLineBg = addLayer(L.polyline(toHome.coords, { color: '#ffffff', weight: 9, opacity: 0.9, lineCap: 'round' }));
    const homeLine = addLayer(L.polyline(toHome.coords, { color: '#ff5a1f', weight: 5, opacity: 0.95, lineCap: 'round' }));
    const driverMarker = L.marker(driverStart, { icon: driverIcon, zIndexOffset: 1000 });

    order = {
      no: orderNo, rest, menu, driver, toRest, toHome, T, sim: 0,
      startedAt: Date.now(), placedClock: new Date(),
      driverMarker, restLine, homeLine, homeLineBg, driverShown: false,
      flags: {}, lastLineUpdate: 0, lastPan: 0, phase: null,
    };

    map.fitBounds(L.latLngBounds([homePt, rest.pos, driverStart]), { ...mapPadding(), maxZoom: 16 });
    follow = false;
    $('recenterBtn').classList.add('off');

    if (!toHome.real) toast('Routing service unavailable – using approximate route');
    lastFrame = performance.now();
    rafId = requestAnimationFrame(tick);
  }

  function plate() {
    const L3 = 'ABCDEFGHJKLMNPRSTUVWXYZ';
    return `${Math.floor(rand(1, 9))}${pick(L3)}${pick(L3)}${pick(L3)}${Math.floor(rand(100, 999))}`;
  }

  function renderItems(menu) {
    const n = Math.floor(rand(2, 4.99));
    const chosen = [...menu.items].sort(() => Math.random() - 0.5).slice(0, n);
    let total = 0;
    const rows = chosen.map(([name, price]) => {
      const q = Math.random() < 0.25 ? 2 : 1;
      total += q * price;
      return `<div class="item"><span><span class="q">${q}×</span>${name}</span><span>$${(q * price).toFixed(2)}</span></div>`;
    });
    total += 2.99; // delivery fee
    rows.push('<div class="item"><span>Delivery fee</span><span>$2.99</span></div>');
    rows.push(`<div class="item total"><span>Total</span><span>$${total.toFixed(2)}</span></div>`);
    $('items').innerHTML = rows.join('');
  }

  function setProgress(stepIdx, frac) {
    document.querySelectorAll('.seg').forEach((seg, i) => {
      const w = i < stepIdx ? 1 : i === stepIdx ? frac : 0;
      seg.firstElementChild.style.width = `${Math.max(0, Math.min(1, w)) * 100}%`;
      seg.classList.toggle('active', i === stepIdx && frac < 1);
    });
  }

  function once(key, fn) {
    if (!order.flags[key]) { order.flags[key] = true; fn(); }
  }

  function showDriver(pos, heading) {
    const o = order;
    if (!o.driverShown) {
      o.driverMarker.addTo(map);
      layers.push(o.driverMarker);
      o.driverShown = true;
      $('driverCard').hidden = false;
      $('driverName').textContent = o.driver.name;
      $('driverAvatar').textContent = o.driver.avatar;
      $('driverRating').textContent = o.driver.rating;
      $('driverCar').textContent = o.driver.car;
      setSheetHeightVar();
    }
    o.driverMarker.setLatLng(pos);
    const arrow = o.driverMarker.getElement() && o.driverMarker.getElement().querySelector('.arrow');
    if (arrow) arrow.style.transform = `rotate(${heading}deg)`;
    const now = performance.now();
    if (follow && now - o.lastPan > 250) {
      o.lastPan = now;
      map.panTo(visibleCenter(pos), { animate: true, duration: 0.25, easeLinearity: 1 });
    }
  }

  // ---------------------------------------------------------------- main loop
  function tick(now) {
    const o = order;
    if (!o) return;
    const dt = Math.min((now - lastFrame) / 1000, 120);
    lastFrame = now;
    if (!paused) o.sim += dt * speed;
    const t = o.sim;
    const T = o.T;

    const remaining = Math.max(0, T.delivered - t);
    $('etaMin').textContent = remaining > 0 ? Math.max(1, Math.ceil(remaining / 60)) : '✓';

    const etaClock = new Date(o.placedClock.getTime() + T.delivered * 1000);
    const etaWindow = `${fmtClock(new Date(etaClock - 4 * 60000))} – ${fmtClock(new Date(etaClock.getTime() + 4 * 60000))}`;

    // Driver: heading to restaurant
    const driverAccepted = T.confirmed + 20;
    if (t >= driverAccepted && t < T.pickedUp) {
      const p = positionAt(o.toRest, t - driverAccepted);
      showDriver(p.pos, p.heading);
      once('driverAssigned', () => toast(`${o.driver.avatar} ${o.driver.name} is picking up your order`));
    }

    if (t < T.confirmed) {
      setStatus('Order confirmed', `${o.rest.name} is reviewing your order`);
      setProgress(0, t / T.confirmed);
    } else if (t < T.pickedUp) {
      const frac = (t - T.confirmed) / (T.pickedUp - T.confirmed);
      setProgress(1, frac);
      once('prep', () => toast(`👨‍🍳 ${o.rest.name} started preparing your food`));
      if (t >= T.driverAtRest) {
        setStatus('Driver is at the restaurant', t < T.prepDone ? 'Food is almost ready…' : 'Picking up your order now');
        once('atRest', () => toast(`${o.driver.name} has arrived at ${o.rest.name}`));
      } else if (t >= T.prepDone) {
        setStatus('Your food is ready', `Waiting for ${o.driver.name} to pick it up · Arriving ${etaWindow}`);
      } else {
        setStatus('Preparing your order', `Estimated arrival ${etaWindow}`);
      }
      $('navHint').hidden = true;
    } else if (t < T.atDoor) {
      // On the way!
      once('pickedUp', () => {
        toast(`🛍️ ${o.driver.name} picked up your order!`);
        map.removeLayer(o.restLine);
        follow = true;
        $('recenterBtn').classList.remove('off');
        map.setView(visibleCenter(o.toHome.coords[0], 16), 16, { animate: true });
        $('navHint').hidden = false;
        setSheetHeightVar();
      });
      const dtHome = t - T.pickedUp;
      const p = positionAt(o.toHome, dtHome);
      showDriver(p.pos, p.heading);
      const distLeft = remainingDistance(o.toHome, p.idx, p.pos);
      setProgress(2, dtHome / o.toHome.total);

      if (now - o.lastLineUpdate > 120) {
        o.lastLineUpdate = now;
        const rest = [p.pos, ...o.toHome.coords.slice(p.idx + 1)];
        o.homeLine.setLatLngs(rest);
        o.homeLineBg.setLatLngs(rest);
      }

      if (distLeft < 250) {
        setStatus('Almost there!', `${o.driver.name} is ${fmtDist(distLeft)} away`);
        once('near', () => { toast('🔔 Your driver is nearby — get ready!'); vibrate([120, 60, 120]); });
      } else {
        setStatus(`${o.driver.name} is on the way`, `${fmtDist(distLeft)} away · Arriving ${etaWindow}`);
      }
      if (dtHome > o.toHome.total * 0.35) once('msg', () => toast(`💬 ${o.driver.name}: "${pick(DRIVER_MSGS)}"`, 4500));

      const { cur, next } = stepAt(o.toHome, dtHome);
      const showNext = next && next.t - dtHome < 25;
      const s = showNext ? next : cur;
      $('navArrow').textContent = s.arrow;
      $('navText').textContent = s.text;
    } else if (t < T.delivered) {
      once('door', () => {
        const end = o.toHome.coords[o.toHome.coords.length - 1];
        showDriver(end, 0);
        o.homeLine.setLatLngs([]);
        o.homeLineBg.setLatLngs([]);
        $('navHint').hidden = true;
        toast(`🚪 ${o.driver.name} is at your door!`, 4000);
        vibrate([200, 100, 200]);
        setSheetHeightVar();
      });
      setStatus('Your driver has arrived', 'Meet them at the door 🚪');
      setProgress(3, (t - T.atDoor) / (T.delivered - T.atDoor));
    } else {
      once('delivered', () => {
        setProgress(4, 1);
        setStatus('Delivered! Enjoy your meal 😋', `Delivered at ${fmtClock(new Date(o.placedClock.getTime() + T.delivered * 1000))}`);
        $('etaPill').classList.add('done');
        const mins = Math.round(T.delivered / 60);
        $('doneText').textContent = `${o.driver.name} delivered your order from ${o.rest.name} in ${mins} minutes. How was your delivery?`;
        $('doneModal').hidden = false;
      });
      return; // stop the loop
    }

    rafId = requestAnimationFrame(tick);
  }

  function vibrate(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch { /* ignore */ }
  }

  // ---------------------------------------------------------------- events
  document.querySelectorAll('.speed button[data-speed]').forEach((b) => {
    b.addEventListener('click', () => {
      const v = Number(b.dataset.speed);
      if (v === 0) {
        paused = !paused;
      } else {
        speed = v; paused = false;
        storage.set('swiftbite-speed', String(v));
      }
      renderSpeedButtons();
    });
  });

  $('recenterBtn').addEventListener('click', () => {
    follow = true;
    $('recenterBtn').classList.remove('off');
    if (order && order.driverShown) {
      const z = Math.max(map.getZoom(), 16);
      map.setView(visibleCenter(order.driverMarker.getLatLng(), z), z);
    }
    else if (home) map.setView([home.lat, home.lng], 15);
  });
  map.on('dragstart', () => { follow = false; $('recenterBtn').classList.add('off'); });

  $('restartBtn').addEventListener('click', () => { if (home) newOrder(); });
  $('againBtn').addEventListener('click', () => newOrder());

  $('sheetHandle').addEventListener('click', () => {
    $('sheet').classList.toggle('collapsed');
    setTimeout(setSheetHeightVar, 320);
  });
  window.addEventListener('resize', setSheetHeightVar);

  $('msgBtn').addEventListener('click', () => order && toast(`💬 ${order.driver.name}: "${pick(DRIVER_MSGS)}"`, 4000));
  $('callBtn').addEventListener('click', () => order && toast(`📞 Calling ${order.driver.name}… (it's a simulation, they can't hear you 😄)`, 3500));

  document.querySelectorAll('#stars button').forEach((b) => {
    b.addEventListener('click', () => {
      const v = Number(b.dataset.v);
      document.querySelectorAll('#stars button').forEach((s) => s.classList.toggle('on', Number(s.dataset.v) <= v));
      toast(v >= 4 ? 'Thanks! Your driver will love that ⭐' : 'Thanks for the feedback');
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
      await setHome(loc);
    } catch {
      $('addrError').textContent = "Couldn't find that address. Try adding a city.";
    }
  });
  $('retryGeo').addEventListener('click', () => { $('locModal').hidden = true; locate(); });
  $('demoLoc').addEventListener('click', () => { $('locModal').hidden = true; setHome(CFG.demoLocation); });

  // ---------------------------------------------------------------- boot
  renderSpeedButtons();
  setSheetHeightVar();
  locate();
})();
