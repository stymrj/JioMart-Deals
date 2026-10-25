/*!
 * PriceDrop Hunter for JioMart
 * Runs in your own browser session as a bookmarklet or userscript.
 */
(function () {
  'use strict';
  if (window.__JMQ__) { window.__JMQ__.toggle(); return; }
  // The page's own window (a userscript sandbox wraps `window`).
  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  // ───────────────────────── Utils ─────────────────────────
  const $inr = n => '₹' + Math.round(n).toLocaleString('en-IN');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const debounce = (f, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };

  const price = v => { if (v == null) return 0; if (typeof v === 'number') return v; const m = String(v).replace(/,/g, '').match(/\d+(\.\d+)?/); return m ? +m[0] : 0; };
  const guessBrand = t => (String(t).trim().split(/\s+/)[0] || '').replace(/[^\w&'-]/g, '');
  const EXCLUDED = [];
  const allowed = p => { const t = p.title.toLowerCase(); return !EXCLUDED.some(k => t.includes(k)); };
  const KWG = (id, name, kws) => ({ id, name, subs: kws.map(k => [k, k[0].toUpperCase() + k.slice(1)]) });

  // ───────────────────────── Catalogue ─────────────────────────
  // JioMart's product API (Fynd), sorted by discount, one top-level category per group.
  const GROUPS = [
    { id: "cooking-essentials", name: "Cooking Essentials", subs: [["cooking-essentials", "Cooking Essentials"]] },
    { id: "fresh-l1", name: "Fresh", subs: [["fresh-l1", "Fresh"]] },
    { id: "biscuits-drinks-packaged-foods", name: "Biscuits, Drinks & Packaged Foods", subs: [["biscuits-drinks-packaged-foods", "Biscuits, Drinks & Packaged Foods"]] },
    { id: "personal-care", name: "Personal Care", subs: [["personal-care", "Personal Care"]] },
    { id: "beauty", name: "Beauty", subs: [["beauty", "Beauty"]] },
    { id: "mom-baby-care", name: "Mom & Baby Care", subs: [["mom-baby-care", "Mom & Baby Care"]] },
    { id: "home", name: "Home", subs: [["home", "Home"]] },
    { id: "kitchenware-l1", name: "Kitchenware", subs: [["kitchenware-l1", "Kitchenware"]] },
    { id: "tableware-l1", name: "Tableware", subs: [["tableware-l1", "Tableware"]] },
    { id: "school-office-stationery", name: "School, Office & Stationery", subs: [["school-office-stationery", "School, Office & Stationery"]] },
    { id: "mobiles-tablets", name: "Mobiles & Tablets", subs: [["mobiles-tablets", "Mobiles & Tablets"]] },
    { id: "tv-home-entertainment", name: "TV & Home Entertainment", subs: [["tv-home-entertainment", "TV & Home Entertainment"]] },
    { id: "audio-smart-home-l1", name: "Audio & Smart Home", subs: [["audio-smart-home-l1", "Audio & Smart Home"]] },
    { id: "wearables-smart-tech-l1", name: "Wearables & Smart Tech", subs: [["wearables-smart-tech-l1", "Wearables & Smart Tech"]] },
    { id: "computers-accessories-l1", name: "Computers & Accessories", subs: [["computers-accessories-l1", "Computers & Accessories"]] },
    { id: "kitchen-appliances", name: "Kitchen Appliances", subs: [["kitchen-appliances", "Kitchen Appliances"]] },
    { id: "home-appliances", name: "Home Appliances", subs: [["home-appliances", "Home Appliances"]] },
    { id: "large-appliances-l1", name: "Large Appliances", subs: [["large-appliances-l1", "Large Appliances"]] },
    { id: "personal-care-grooming-appliances-l1", name: "Grooming Appliances", subs: [["personal-care-grooming-appliances-l1", "Grooming Appliances"]] },
    { id: "camera-musical-instruments-l1", name: "Camera & Music", subs: [["camera-musical-instruments-l1", "Camera & Music"]] }
  ];
  let noLoc = false;
  // JioMart keeps the delivery location in localStorage ("pin") and in a cookie.
  function location0() {
    try { const v = localStorage.getItem('pin'); if (v && /pincode/.test(v)) return v; } catch (e) { /* ignore */ }
    try { const m = document.cookie.match(/(?:^|; )app_location_details=([^;]*)/); if (m) return decodeURIComponent(m[1]); } catch (e) { /* ignore */ }
    return '';
  }
  const pinOf = () => { try { return JSON.parse(location0()).pincode || ''; } catch (e) { return ''; } };
  function normalise(x, cat) {
    const pr = x.price || {}, sell = price(pr.effective && pr.effective.min), mrp0 = price(pr.marked && pr.marked.min);
    if (!x.name || !sell) return null;
    const mrp = mrp0 < sell ? sell : mrp0, h = x.hierarchy || {};
    if (mrp > sell * 20) return null; // 95%+ off is almost always an inflated list price
    const c = (h.l1_category && h.l1_category.name) || cat, sub = h.l2_category && h.l2_category.name;
    return { id: String(x.uid || x.item_code || x.slug), title: String(x.name), brand: String((x.brand && x.brand.name) || guessBrand(x.name)), price: sell, mrp,
      disc: mrp > sell ? Math.round((mrp - sell) / mrp * 100) : 0, save: mrp - sell,
      img: (x.medias && x.medias[0] && x.medias[0].url) || '', url: x.slug ? 'https://www.jiomart.com/product/' + x.slug : '',
      inStock: x.sellable !== false, cat: sub ? c + ' › ' + sub : c };
  }
  async function fetchPage(job, page, ctl) {
    const loc = location0();
    if (!loc) { noLoc = true; return Object.assign([], { more: false }); }
    const url = '/api/service/application/catalog/v1.0/products/?page_size=40&sort_on=discount_dsc&page_no=' + page + '&f=' + encodeURIComponent('l1_category:' + job.code);
    let lastErr;
    for (let a = 0; a < 3; a++) {
      if (ctl.stop) throw new Error('stopped');
      try {
        const r = await W.fetch(url, { credentials: 'include', headers: { accept: 'application/json', 'x-location-detail': loc } });
        if (r.status === 400) { noLoc = true; return Object.assign([], { more: false }); }
        if (r.status === 429 || r.status >= 500) throw new Error('HTTP ' + r.status);
        if (!r.ok) return Object.assign([], { more: false });
        const j = await r.json();
        const items = (j.items || []).map(x => normalise(x, job.g.name)).filter(Boolean);
        items.more = !!(j.page && j.page.has_next);
        return items;
      } catch (e) { lastErr = e; await sleep(800 * (a + 1)); }
    }
    throw lastErr;
  }
  const P = {
    key: 'jmq_v1', hostRe: /(^|\.)jiomart\.com$/,
    defaults: { groups: ['cooking-essentials', 'fresh-l1', 'biscuits-drinks-packaged-foods'], depth: 2 },
    workers: 3,
    jobs: st => { const jobs = []; for (const g of GROUPS) if (st.groups.includes(g.id)) jobs.push({ g, name: g.name, code: g.id }); return jobs; },
    fetchPage,
    noLocation: () => noLoc,
    noLocMsg: 'No products. Set your delivery pincode on jiomart.com, then scan again.',
    locCheck: () => !!pinOf(),
    locUI: () => `<div class="row" style="margin-bottom:6px"><span>Delivering to</span><b>${esc(pinOf() || 'Not set')}</b></div>`,
    locInput: () => false
  };
  // Live data can only be read from the store's own site, inside your logged-in tab.
  const OFFSITE = !P.hostRe.test(location.hostname);

  const KEY = P.key;
  const defaults = Object.assign({
    theme: 'auto', view: 'grid', sort: 'score', minDisc: 30, maxPrice: 0, depth: 3,
    stockOnly: true, favs: [], hidden: [], list: {}, prices: {}, lastScan: 0
  }, P.defaults);
  let store;
  try { store = Object.assign({}, defaults, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { store = Object.assign({}, defaults); }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* quota/private mode */ } };
  store.groups = (store.groups || []).filter(id => GROUPS.some(g => g.id === id));
  if (!store.groups.length) store.groups = defaults.groups.slice();
  delete store.auto; // every scan is started by hand
  // v3: Hunter scans every category by itself and leads with the biggest discounts.
  if (store.v !== 3) { store.groups = GROUPS.map(g => g.id); store.sort = 'disc'; store.depth = (typeof P !== 'undefined' && P.defaults && P.defaults.depth) || 2; store.v = 3; save(); }

  // ───────────────────────── State ─────────────────────────
  const S = { products: new Map(), scanning: false, done: 0, total: 0, errors: 0, ctl: { stop: false },
    q: '', brand: '', cat: '', preset: '', pick: false, tgm: false, favOnly: false, newOnly: false, shown: 60, tab: 'best', panel: false, startedAt: 0 };

  // ───────────────────────── Scanner ─────────────────────────
  async function scan() {
    if (S.scanning) return;
    if (OFFSITE) { toast('Open ' + PLATFORM + ' to fetch live deals.'); return; }
    if (typeof captureUI === 'function') { autoScroll(); return; }
    const jobs = P.jobs(store);
    if (!jobs.length) { toast('Pick at least one category'); return; }
    S.scanning = true; S.ctl = { stop: false }; S.done = 0; S.errors = 0; S.total = jobs.length; S.startedAt = Date.now();
    S.products.clear(); S.shown = 60; render();
    const ctl = S.ctl, queue = jobs.slice();
    const runJob = async job => {
      try {
        for (let page = 1; page <= store.depth && !ctl.stop; page++) {
          const items = await P.fetchPage(job, page, ctl);
          const fresh = ingest(items);
          scheduleRender();
          // Stop on the last page, or when a page adds nothing and does not promise more.
          if (items.more === false || (!fresh && items.more !== true)) break;
        }
      } catch (e) { if (!ctl.stop) S.errors++; }
      S.done++; scheduleRender();
    };
    // The first request finds the right data centre; then the workers run in parallel.
    if (queue.length) await runJob(queue.shift());
    const worker = async () => { while (queue.length && !ctl.stop) await runJob(queue.shift()); };
    await Promise.all(Array.from({ length: (typeof P !== 'undefined' && P.workers) || 4 }, worker));
    S.scanning = false;
    recordPrices();
    store.lastScan = Date.now(); save(); render();
    notify();
    if (P.noLocation() && !S.products.size) { toast(P.noLocMsg); return; }
    toast(ctl.stop ? 'Scan stopped' : `Scan complete · ${S.products.size} products` + (S.errors ? ` · ${S.errors} failed` : ''));
  }

  // ───────────────────────── Filtering ─────────────────────────
  // Unit price: rupees per kg, litre or piece, read from the pack size in the title.
  const UNITS = { kg: ['kg', 1], kgs: ['kg', 1], g: ['kg', .001], gm: ['kg', .001], gms: ['kg', .001], gram: ['kg', .001], grams: ['kg', .001], l: ['L', 1], ltr: ['L', 1], litre: ['L', 1], liter: ['L', 1], ml: ['L', .001], pc: ['pc', 1], pcs: ['pc', 1], piece: ['pc', 1], pieces: ['pc', 1], unit: ['pc', 1], units: ['pc', 1] };
  function unitOf(t) {
    const m = String(t).toLowerCase().match(/(?:(\d+)\s*[x×]\s*)?(\d+(?:\.\d+)?)\s*(kgs?|gms?|grams?|g|ltr|litre|liter|l|ml|pcs?|pieces?|units?)\b/);
    if (!m || !UNITS[m[3]]) return null;
    const u = UNITS[m[3]], qty = (m[1] ? +m[1] : 1) * +m[2] * u[1];
    return qty > 0 ? { base: u[0], qty } : null;
  }
  const r1 = n => n < 10 ? '₹' + n.toFixed(1) : $inr(n);
  function unitLabel(p) {
    if (!p.unit) return '';
    const per = p.price / p.unit.qty;
    if (p.unit.base === 'pc') return r1(per) + ' per piece';
    return p.unit.qty < 1 ? r1(per / 10) + ' per 100' + (p.unit.base === 'kg' ? ' g' : ' ml') : r1(per) + ' per ' + p.unit.base;
  }
  const unitVal = p => p.unit ? p.price / p.unit.qty : 1e12;
  const PRESETS = {
    under99: ['Under ₹99', p => p.price <= 99],
    half: ['50% off or more', p => p.disc >= 50],
    big: ['Save ₹100+', p => p.save >= 100],
    drops: ['Price drops', p => !!p.was],
    lowest: ['Lowest ever', p => !!p.lowEver],
    value: ['Best value per kg / L', p => !!p.unit]
  };
  // Price history: a few points per product, kept only in this browser.
  store.hist = store.hist || {};
  store.favAt = store.favAt || {};
  function recordPrices() {
    const now = Date.now(), h = store.hist;
    S.products.forEach(p => {
      store.prices[p.id] = p.price;
      const a = h[p.id] || (h[p.id] = []), last = a[a.length - 1];
      if (!last || last[1] !== p.price || now - last[0] > 864e5) { a.push([now, p.price]); if (a.length > 10) a.shift(); }
    });
    const ks = Object.keys(h); if (ks.length > 2500) ks.slice(0, ks.length - 2500).forEach(k => delete h[k]);
    const ps = Object.keys(store.prices); if (ps.length > 6000) ps.slice(0, ps.length - 6000).forEach(k => delete store.prices[k]);
  }
  const score = p => p.disc + Math.min(30, p.save / 8);
  const SORTS = {
    score: ['Best deal', (a, b) => score(b) - score(a)],
    disc: ['Highest discount', (a, b) => b.disc - a.disc || b.save - a.save],
    save: ['Biggest saving ₹', (a, b) => b.save - a.save],
    pasc: ['Price: low → high', (a, b) => a.price - b.price],
    pdesc: ['Price: high → low', (a, b) => b.price - a.price],
    unit: ['Unit price: low → high', (a, b) => unitVal(a) - unitVal(b)],
    name: ['Name A–Z', (a, b) => a.title.localeCompare(b.title)]
  };
  function filtered() {
    const q = S.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const fav = new Set(store.favs), hid = new Set(store.hidden);
    const out = [];
    S.products.forEach(p => {
      if (hid.has(p.id)) return;
      if (store.stockOnly && !p.inStock) return;
      if (p.disc < store.minDisc) return;
      if (store.maxPrice && p.price > store.maxPrice) return;
      if (S.brand && p.brand !== S.brand) return;
      if (S.tab === 'all' && S.cat && p.cat.split(' › ')[0] !== S.cat) return;
      if ((S.favOnly || S.tab === 'saved') && !fav.has(p.id)) return;
      if (S.newOnly && !p.isNew && !p.was) return;
      if (S.preset && !PRESETS[S.preset][1](p)) return;
      if (q.length) { const t = (p.title + ' ' + p.cat).toLowerCase(); if (!q.every(w => t.includes(w))) return; }
      out.push(p);
    });
    return out.sort(S.preset === 'value' ? SORTS.unit[1] : SORTS[store.sort][1]);
  }

  // ───────────────────────── UI ─────────────────────────
  const PLATFORM = 'JioMart';
  const STORE_URL = 'https://www.jiomart.com/';
  const host = document.createElement('div');
  host.id = 'fkm-host';
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;display:none';
  const root = host.attachShadow({ mode: 'open' });
  const ICONS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    bag: '<path d="M6 7h12l1 13H5L6 7z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    eyeoff: '<path d="M9.9 4.2A10 10 0 0 1 12 4c7 0 10 8 10 8a17 17 0 0 1-2.2 3.2M6.6 6.6C3.6 8.6 2 12 2 12s3 8 10 8a9.7 9.7 0 0 0 5.4-1.6"/><path d="M14.1 14.1a3 3 0 1 1-4.2-4.2"/><path d="m2 2 20 20"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
    scan: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    ext: '<path d="M14 3h7v7M10 14 21 3M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>',
    arrowdown: '<path d="M12 4v13M6.5 11.5 12 17l5.5-5.5"/><path d="M6 21h12"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'
  };
  const ic = (n, s) => `<svg class="i" viewBox="0 0 24 24" width="${s || 18}" height="${s || 18}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;
  const CSS = `
:host{all:initial}
*{box-sizing:border-box;margin:0}
.app{--bg:#f4f5f8;--sf:#fff;--sf2:#eef0f4;--tx:#101218;--mt:#5f6573;--bd:#e2e5eb;--pr:#0078ad;--pr2:#00628d;--ac:#ffd43b;--on:#111;--hd:#0078ad;--ok:#0b8a3d;--hot:#e0331f;
 position:absolute;inset:0;background:var(--bg);color:var(--tx);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;display:flex;flex-direction:column;-webkit-font-smoothing:antialiased}
.app.dark{--bg:#0d0f14;--sf:#161920;--sf2:#1e222b;--tx:#eef0f4;--mt:#9097a6;--bd:#2a2f3a;--pr:#38b6ff;--pr2:#38b6ff;--ok:#34c26b;--hot:#ff5a45}
button,input,select{font:inherit;color:inherit}
button{cursor:pointer;border:0;background:none}
.i{display:block;flex:none}
header{display:flex;align-items:center;gap:10px;padding:0 18px;height:68px;flex:none;background:var(--hd);color:#fff;position:relative;box-shadow:0 1px 0 rgba(0,0,0,.08)}
.logo{display:flex;align-items:center;gap:11px;white-space:nowrap;margin-right:6px}
.logo .mk{width:38px;height:38px;border-radius:11px;background:var(--ac);color:var(--on);display:grid;place-items:center;flex:none}
.logo b{display:block;font-weight:800;font-size:16px;letter-spacing:-.3px;line-height:1.15}
.logo small{display:flex;align-items:center;gap:6px;font-weight:600;font-size:12px;opacity:.82;line-height:1.3}
.flag{font-size:10.5px;font-weight:800;background:rgba(255,255,255,.2);border-radius:5px;padding:0 6px;letter-spacing:.03em;text-transform:uppercase}
.search{flex:1;max-width:540px;min-width:140px;position:relative;display:flex;align-items:center}
.search .i{position:absolute;left:13px;color:#7a808c;pointer-events:none}
.search input{width:100%;height:42px;border:0;border-radius:12px;padding:0 44px 0 40px;background:#fff;color:#111;outline:0;font-size:14px;box-shadow:0 1px 2px rgba(0,0,0,.08)}
.search input:focus{box-shadow:0 0 0 3px rgba(255,255,255,.35)}
.search input::placeholder{color:#8a8f9b}
.search kbd{position:absolute;right:10px;color:#7a808c;background:#f1f2f5;border:1px solid #e2e5eb}
.sp{flex:1}
.ib,.hb,.sb{height:42px;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;gap:8px;font-weight:700;font-size:13.5px;white-space:nowrap;position:relative;transition:background .15s}
.ib{width:42px;background:rgba(255,255,255,.14);color:#fff}
.hb{padding:0 14px;background:rgba(255,255,255,.14);color:#fff}
.ib:hover,.hb:hover{background:rgba(255,255,255,.26)}
.sb{padding:0 16px;background:var(--ac);color:var(--on);font-weight:800}
.sb:hover{filter:brightness(.95)}
.sb.stop{background:#fff;color:#111}
.hb .n{background:var(--ac);color:var(--on);border-radius:99px;padding:0 7px;font-size:11px;font-weight:800;line-height:18px}
.dot{position:absolute;top:9px;right:9px;width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.45);box-shadow:0 0 0 2px var(--hd)}
.dot.on{background:#3ddc84}
.prog{position:absolute;left:0;bottom:0;height:3px;background:var(--ac);transition:width .3s}
.body{flex:1;display:flex;min-height:0}
aside{width:284px;flex:none;background:var(--sf);border-right:1px solid var(--bd);overflow:auto;padding:22px 20px 40px;display:flex;flex-direction:column;gap:28px}
aside h4{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;margin-bottom:12px}
aside h4 .i{color:var(--pr)}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--bd);background:var(--sf);border-radius:99px;padding:5px 12px;font-size:12.5px;font-weight:600;white-space:nowrap}
.chip:hover{border-color:var(--tx)}
.chip.on{background:var(--pr);border-color:var(--pr);color:#fff}
.row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.row b{font-weight:800}
.fld{width:100%;height:38px;padding:0 12px;border:1px solid var(--bd);border-radius:10px;background:var(--bg);outline:0;font-weight:600}
.fld:focus,select:focus{border-color:var(--pr)}
.stack{display:flex;flex-direction:column;gap:8px}
input[type=range]{width:100%;accent-color:var(--pr);margin-top:4px}
input[type=checkbox]{accent-color:var(--pr);width:16px;height:16px}
.sw{display:flex;gap:10px;align-items:center;cursor:pointer;font-weight:500}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:var(--ac);color:var(--on);border-radius:12px;height:46px;font-weight:800;font-size:15px;width:100%}
.btn:hover{filter:brightness(.95)}
.btn.stop{background:var(--tx);color:var(--bg)}
.btn.ghost{background:var(--sf);color:var(--tx);border:1px solid var(--bd);height:40px;font-size:13.5px;width:auto;padding:0 16px}
.btn.ghost:hover{border-color:var(--tx);filter:none}
.btn.full{width:100%}
.note{color:var(--mt);font-size:12.5px;line-height:1.55}
.note b{color:var(--tx)}
.tgcard{border:1px solid var(--bd);border-radius:14px;padding:14px;background:var(--bg)}
.tgcard.on{border-color:var(--pr)}
main{flex:1;overflow:auto;padding:24px 28px 56px;min-width:0}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}
.st{background:var(--sf);border:1px solid var(--bd);border-radius:14px;padding:14px 16px}
.st b{display:block;font-size:26px;font-weight:800;letter-spacing:-.8px;line-height:1.15}
.st span{color:var(--mt);font-size:12.5px;font-weight:600}
.st.hl{background:var(--pr);border-color:var(--pr);color:#fff}.st.hl span{color:rgba(255,255,255,.8)}
.tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:20px}
select{height:38px;border:1px solid var(--bd);border-radius:10px;background:var(--sf);padding:0 10px;outline:0;font-weight:600;max-width:190px}
.seg{display:inline-flex;background:var(--sf2);border-radius:10px;padding:3px}
.seg button{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;font-size:13px;font-weight:700;border-radius:8px;color:var(--mt)}
.seg button.on{background:var(--sf);color:var(--tx);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:16px}
.grid.list{grid-template-columns:1fr;gap:10px}
.card{background:var(--sf);border:1px solid var(--bd);border-radius:16px;overflow:hidden;display:flex;flex-direction:column;position:relative;transition:transform .15s,box-shadow .15s}
.card:hover{transform:translateY(-3px);box-shadow:0 10px 24px rgba(16,18,24,.08)}
.card.oos .im,.card.oos .inf{opacity:.5}
.list .card{flex-direction:row}.list .card:hover{transform:none}
.list .im{width:110px;height:110px;flex:none;aspect-ratio:auto}
.im{aspect-ratio:1;background:var(--sf2) center/cover no-repeat;position:relative}
.dc{position:absolute;left:10px;top:10px;background:var(--ok);color:#fff;border-radius:8px;font-size:12px;font-weight:800;padding:3px 8px}
.dc.hot{background:var(--hot)}
.tg{position:absolute;left:10px;top:38px;display:inline-flex;align-items:center;gap:4px;background:var(--ac);color:var(--on);border-radius:6px;font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.03em;padding:2px 7px}
.fv{position:absolute;top:8px;right:8px;width:34px;height:34px;border-radius:50%;background:#fff;color:#7a808c;display:grid;place-items:center;box-shadow:0 1px 4px rgba(0,0,0,.14)}
.fv:hover{color:var(--hot)}
.fv.on{color:var(--hot)}.fv.on svg{fill:currentColor}
.inf{padding:12px 14px 14px;display:flex;flex-direction:column;gap:3px;flex:1;min-width:0}
.ti{font-size:14px;font-weight:650;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:var(--tx);text-decoration:none}
a.ti:hover{color:var(--pr)}
.ct{font-size:12px;color:var(--mt);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pr{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-top:6px}
.pr b{font-size:21px;font-weight:800;letter-spacing:-.6px}
.pr s{color:var(--mt);font-size:13px}
.sv{font-size:12.5px;color:var(--ok);font-weight:700}
.sv i{font-style:normal;color:var(--hot)}
.was{font-size:12px;color:var(--mt)}
.acts{display:flex;gap:6px;margin-top:auto;padding-top:12px}
.acts button{flex:1;height:38px;border-radius:10px;font-size:13px;font-weight:800;background:var(--pr);color:#fff;display:inline-flex;align-items:center;justify-content:center;gap:6px}
.acts button:hover{background:var(--pr2)}
.acts .add.in{background:var(--sf);color:var(--pr);box-shadow:inset 0 0 0 1.5px var(--pr)}
.acts .hide{flex:none;width:40px;background:var(--sf2);color:var(--mt)}
.acts .hide:hover{background:var(--bd);color:var(--tx)}
.empty{color:var(--mt);padding:80px 20px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:6px}
.empty .ei{width:56px;height:56px;border-radius:16px;background:var(--sf2);color:var(--pr);display:grid;place-items:center;margin-bottom:8px}
.empty b{display:block;color:var(--tx);font-size:18px;font-weight:800}
.drawer{position:absolute;top:0;right:0;bottom:0;width:min(420px,100%);background:var(--sf);display:flex;flex-direction:column;transform:translateX(105%);transition:transform .22s;z-index:5;box-shadow:-16px 0 40px rgba(0,0,0,.16)}
.drawer.open{transform:none}
.drawer header{gap:10px}
.drawer header b{flex:1;display:flex;align-items:center;gap:10px;font-size:17px;font-weight:800}
.dl{flex:1;overflow:auto;padding:6px 20px}
.li{display:flex;gap:12px;align-items:center;padding:14px 0;border-bottom:1px solid var(--bd)}
.li img{width:52px;height:52px;border-radius:10px;object-fit:cover;background:var(--sf2)}
.li div{flex:1;min-width:0;font-size:13px}.li .ti{-webkit-line-clamp:1;font-size:13.5px}
.li s{color:var(--mt);font-size:12px;margin-left:6px}
.qty{display:flex;align-items:center;gap:8px;font-weight:800}.qty button{width:30px;height:30px;border-radius:9px;background:var(--sf2);display:grid;place-items:center}
.df{padding:18px 20px;border-top:1px solid var(--bd);display:flex;flex-direction:column;gap:10px}
.df .tot{font-size:24px;font-weight:800;letter-spacing:-.6px}
.toast{position:absolute;left:50%;bottom:24px;transform:translateX(-50%) translateY(80px);background:var(--tx);color:var(--bg);padding:12px 18px;border-radius:12px;opacity:0;transition:.2s;pointer-events:none;z-index:9;max-width:90%;font-weight:600}
.toast.on{transform:translateX(-50%);opacity:1}
.menu-btn{display:none}
kbd{border:1px solid var(--bd);border-radius:5px;padding:0 5px;font-size:11px;font-weight:700}
.presets{display:flex;gap:6px;flex-wrap:wrap;margin:-4px 0 16px}
.presets .chip{padding:6px 13px}
.tg.low{background:var(--ok);color:#fff}
.up{font-size:12px;color:var(--mt);font-weight:600}
.hist{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--mt);font-weight:600;margin-top:2px}
.hist svg{flex:none}
.watch{background:var(--sf);border:1px solid var(--bd);border-radius:16px;padding:14px 16px;margin-bottom:18px}
.wh{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}
.wh b{display:flex;align-items:center;gap:8px;font-weight:800}.wh b .i{color:var(--hot);fill:var(--hot)}
.wh span{color:var(--mt);font-size:12.5px;font-weight:600}
.wl{display:flex;gap:10px;overflow-x:auto;padding-bottom:4px}
.mini{flex:none;width:230px;display:flex;gap:10px;align-items:center;border:1px solid var(--bd);border-radius:12px;padding:8px;text-decoration:none;color:inherit;background:var(--bg)}
.mini img{width:48px;height:48px;border-radius:9px;object-fit:cover;background:var(--sf2)}
.mini div{min-width:0;font-size:12.5px}.mini .ti{-webkit-line-clamp:1;font-size:13px}
.mini em{font-style:normal;font-weight:700;font-size:11.5px}.mini .dn{color:var(--ok)}.mini .upx{color:var(--hot)}.mini .eq{color:var(--mt)}
.check{max-width:520px;margin:40px auto;background:var(--sf);border:1px solid var(--bd);border-radius:20px;padding:24px}
.check h3{font-size:19px;font-weight:800;margin-bottom:14px;letter-spacing:-.3px}
.ck{display:flex;gap:12px;padding:10px 0;border-top:1px solid var(--bd)}
.ck>span{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;flex:none}
.ck.ok>span{background:color-mix(in srgb,var(--ok) 16%,var(--sf));color:var(--ok)}
.ck.no>span{background:color-mix(in srgb,var(--hot) 16%,var(--sf));color:var(--hot)}
.ck.q>span{background:var(--sf2);color:var(--mt)}
.ck b{font-weight:700}.ck p{color:var(--mt);font-size:12.5px;margin-top:2px}
.tabs{display:flex;align-items:center;gap:6px;margin-bottom:18px;flex-wrap:wrap}
.tabs button{height:38px;padding:0 16px;border-radius:99px;font-weight:800;font-size:13.5px;background:var(--sf);border:1px solid var(--bd);color:var(--mt)}
.tabs button.on{background:var(--tx);border-color:var(--tx);color:var(--bg)}
.live{display:inline-flex;align-items:center;gap:6px;margin-left:auto;font-size:12.5px;font-weight:700;color:var(--pr)}
.live .i{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
.sec{margin-bottom:28px}
.sh{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:12px}
.sh h3{font-size:18px;font-weight:800;letter-spacing:-.3px}
.sh span{color:var(--mt);font-size:12.5px;font-weight:600}
.more{display:inline-flex;align-items:center;gap:5px;color:var(--pr);font-weight:800;font-size:13px;white-space:nowrap}
.hs{display:grid;grid-auto-flow:column;grid-auto-columns:210px;gap:14px;overflow-x:auto;padding-bottom:6px;scrollbar-width:thin}
.mob{display:none}
.picker{position:absolute;z-index:7;left:50%;top:50%;transform:translate(-50%,-50%);width:min(580px,calc(100% - 24px));max-height:calc(100% - 40px);display:flex;flex-direction:column;background:var(--sf);border-radius:20px;box-shadow:0 24px 70px rgba(0,0,0,.3);overflow:hidden;animation:fade .15s}
.ph{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 20px;border-bottom:1px solid var(--bd)}
.ph b{display:block;font-size:18px;font-weight:800;letter-spacing:-.3px}.ph small{color:var(--mt);font-size:12.5px;font-weight:600}
.ib.soft{background:var(--sf2);color:var(--tx)}.ib.soft:hover{background:var(--bd)}
.pb{padding:18px 20px;overflow:auto}.pb .chip{padding:7px 13px;font-size:13px}
.pf{display:flex;gap:10px;padding:14px 20px calc(14px + env(safe-area-inset-bottom));border-top:1px solid var(--bd)}.pf .btn{flex:1;width:auto}.pf .btn.ghost{flex:0 0 auto;height:46px}
.btn[disabled]{opacity:.45;pointer-events:none}
.tgb .dot{top:7px;right:7px}
.tgt{display:flex;align-items:center;gap:12px}
.tgi{width:42px;height:42px;border-radius:12px;background:#229ed9;color:#fff;display:grid;place-items:center;flex:none}
.ph small.ok{color:var(--ok)}
.tgs{list-style:none;padding:0;margin:0 0 16px;counter-reset:t;display:flex;flex-direction:column;gap:14px}
.tgs li{counter-increment:t;position:relative;padding-left:40px;display:flex;flex-direction:column;gap:6px}
.tgs li:before{content:counter(t);position:absolute;left:0;top:-1px;width:28px;height:28px;border-radius:9px;background:var(--pr);color:#fff;font-weight:800;font-size:13px;display:grid;place-items:center}
.tgs b{font-weight:800}.tgs span{color:var(--mt);font-size:13px}
.tgs code{font:12px ui-monospace,Menlo,monospace;background:var(--sf2);border-radius:5px;padding:0 5px}
.tlink{align-self:flex-start;display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 13px;border-radius:99px;background:#229ed9;color:#fff;font-weight:700;font-size:12.5px;text-decoration:none}
.tlink:hover{background:#1c8bc0}
.scrim{position:absolute;inset:0;background:rgba(10,12,16,.45);z-index:4;animation:fade .2s}.scrim.side{display:none;z-index:3}@keyframes fade{from{opacity:0}}
.body{position:relative}
@media(max-width:900px){
 aside{position:absolute;z-index:4;top:0;bottom:0;left:0;transform:translateX(-105%);transition:transform .22s;width:min(320px,88%);box-shadow:16px 0 40px rgba(0,0,0,.16);padding:18px 16px 40px}
 aside.open{transform:none}.menu-btn{display:inline-flex}.mob{display:flex}.scrim.side{display:block}
 header{padding:10px 12px;gap:8px;height:auto;flex-wrap:wrap}
 .logo{margin-right:0;min-width:0;flex:1 1 auto;overflow:hidden}.logo>div{min-width:0;overflow:hidden}header .sp{display:none}.logo small,.logo .mk,.search kbd,.hb .lb,.sb .lb,[data-act=bell].ib,[data-act=theme].ib{display:none}
 .logo b{font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
 .ib,.hb,.sb{height:38px}.ib{width:38px}.hb,.sb{padding:0 11px}
 .search{order:9;flex-basis:100%;max-width:none;min-width:0}.search input{height:40px}
 main{padding:14px 12px 40px}
 .stats,.presets,.tools{display:flex;flex-wrap:nowrap;overflow-x:auto;margin-left:-12px;margin-right:-12px;padding:0 12px;scrollbar-width:none;-webkit-overflow-scrolling:touch}
 .stats::-webkit-scrollbar,.presets::-webkit-scrollbar,.tools::-webkit-scrollbar{display:none}
 .stats{gap:8px;margin-bottom:12px}.st{flex:0 0 auto;min-width:118px;padding:10px 12px;border-radius:12px}.st b{font-size:18px}.st span{font-size:11.5px;white-space:nowrap}
 .presets{margin-top:0;margin-bottom:10px}.presets .chip{flex:0 0 auto}
 .tools{gap:6px;margin-bottom:14px}.tools select{flex:0 0 auto;height:36px;max-width:150px;font-size:13px}.tools .sp{display:none}.seg{flex:0 0 auto}
 .grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
 .tabs{flex-wrap:nowrap;overflow-x:auto;margin:0 -12px 14px;padding:0 12px;scrollbar-width:none}.tabs::-webkit-scrollbar{display:none}.tabs button{flex:0 0 auto;height:36px;padding:0 14px}.live{flex:0 0 auto}
 .hs{grid-auto-columns:46%;gap:10px;margin:0 -12px;padding:0 12px 6px;scrollbar-width:none}.hs::-webkit-scrollbar{display:none}
 .sh h3{font-size:16px}.sec{margin-bottom:22px}
 .card{border-radius:14px}.card:hover{transform:none;box-shadow:none}
 .inf{padding:10px 10px 12px}.ti{font-size:13px}.ct{font-size:11px}.pr b{font-size:17px}.pr s{font-size:12px}.sv,.up{font-size:11.5px}
 .acts button{height:34px;font-size:12px;gap:4px}.acts .hide{width:34px}
 .dc{font-size:11px;padding:2px 6px;left:8px;top:8px}.tg{left:8px;top:32px;font-size:9.5px}.fv{width:30px;height:30px;top:6px;right:6px}
 .list .im{width:88px;height:88px}
 .check{margin:20px 0;padding:18px}
 .picker{top:auto;bottom:0;left:0;transform:none;width:100%;max-height:88%;border-radius:20px 20px 0 0}
 .toast{bottom:calc(16px + env(safe-area-inset-bottom))}
}
`;
  root.innerHTML = '<style>' + CSS + '</style><div class="app" id="app"></div>';
  const app = root.getElementById('app');

  let sideOpen = false;
  const groupChip = g => `<button class="chip ${store.groups.includes(g.id) ? 'on' : ''}" data-act="grp" data-id="${g.id}">${esc(g.name)}</button>`;
  function scanUI() {
    return `<div><h4>${ic('scan', 15)}Scan</h4>
  ${P.locUI(store, esc)}
  <p class="note" style="margin-top:6px">Each scan asks which categories to check. Last time: ${store.groups.length} of ${GROUPS.length}.</p></div>
 ${S.scanning ? `<button class="btn stop" data-act="stop">${ic('stop')}Stop scan</button>` : `<button class="btn" data-act="scan">${ic('scan')}Choose & scan</button>`}`;
  }
  // Asked before every scan: which categories, and how deep.
  function pickerUI() {
    const n = store.groups.length;
    return `<div class="scrim" data-act="pclose" style="z-index:6"></div><div class="picker" role="dialog" aria-label="Choose what to scan">
 <div class="ph"><div><b>What should Hunter scan?</b><small>${esc(PLATFORM)} · pick one or more categories</small></div><button class="ib soft" data-act="pclose" title="Close">${ic('x')}</button></div>
 <div class="pb"><div class="chips">${GROUPS.map(groupChip).join('')}</div>
  <div class="row" style="margin-top:12px;justify-content:flex-start;gap:6px"><button class="chip" data-act="all">Select all</button><button class="chip" data-act="none">Clear</button></div>
  <label class="row" style="margin-top:20px"><span>Pages per category</span><b>${store.depth}</b></label><input type="range" min="1" max="5" value="${store.depth}" data-in="depth">
  <p class="note" style="margin-top:4px">More pages find more deals but take longer.</p></div>
 <div class="pf"><button class="btn ghost" data-act="pclose">Cancel</button><button class="btn" data-act="pstart" ${n ? '' : 'disabled'}>${ic('scan')}Scan ${n} ${n === 1 ? 'category' : 'categories'}</button></div></div>`;
  }
  function openPicker() {
    if (OFFSITE) { toast('Open ' + PLATFORM + ' to fetch live deals.'); return; }
    if (typeof captureUI === 'function') { autoScroll(); return; }
    if (S.scanning) return;
    sideOpen = false; S.pick = true; render();
  }
  // Telegram setup, opened from the header.
  function tgModal() {
    const t = store.tg, ready = tgReady();
    const status = ready ? (t.on ? 'Connected · alerts on' : 'Connected · alerts off') : 'Not set up yet · about 2 minutes';
    return `<div class="scrim" data-act="tgclose" style="z-index:6"></div><div class="picker" role="dialog" aria-label="Telegram alerts">
 <div class="ph"><div class="tgt"><span class="tgi">${ic('send', 20)}</span><div><b>Telegram alerts</b><small class="${ready && t.on ? 'ok' : ''}">${status}</small></div></div><button class="ib soft" data-act="tgclose" title="Close">${ic('x')}</button></div>
 <div class="pb">
  <ol class="tgs">
   <li><b>Create a bot</b><span>Open BotFather, send <code>/newbot</code>, follow the prompts and copy the token.</span><a class="tlink" href="https://t.me/BotFather" target="_blank" rel="noopener">${ic('ext', 14)}Open @BotFather</a></li>
   <li><b>Press Start in your new bot</b><span>So it is allowed to message you.</span></li>
   <li><b>Get your chat ID</b><span>Userinfobot replies with a number: that is your chat ID.</span><a class="tlink" href="https://t.me/userinfobot" target="_blank" rel="noopener">${ic('ext', 14)}Open @userinfobot</a></li>
   <li><b>Paste both here</b>
    <input class="fld" type="password" data-in="tgToken" placeholder="Bot token" value="${esc(t.token)}" autocomplete="off">
    <input class="fld" data-in="tgChat" placeholder="Chat ID" value="${esc(t.chat)}" autocomplete="off" inputmode="numeric"></li>
  </ol>
  <div class="tgcard ${t.on ? 'on' : ''} stack">
   <label class="sw"><input type="checkbox" data-in="tgOn" ${t.on ? 'checked' : ''}> <b>Send deals to Telegram</b></label>
   <label class="row" style="margin-top:4px"><span>Alert from</span><b id="tgminv">${t.minDisc}% off</b></label><input type="range" min="20" max="90" step="5" value="${t.minDisc}" data-in="tgMin">
   <label class="sw"><input type="checkbox" data-in="tgDrops" ${t.drops ? 'checked' : ''}> Any price drop</label>
   <label class="sw"><input type="checkbox" data-in="tgWatch" ${t.watch ? 'checked' : ''}> Saved items that get cheaper</label>
  </div>
  <p class="note" style="margin-top:12px">Alerts go out after each scan. Each deal is sent once, and again only if it gets cheaper. If the test fails on this store, install the userscript. Your token stays in this browser.</p>
 </div>
 <div class="pf"><button class="btn ghost" data-act="tgtest">${ic('send', 16)}Send test</button><button class="btn" data-act="tgclose">Done</button></div></div>`;
  }
  function sidebar() {
    return `<aside class="${sideOpen ? 'open' : ''}">
 <div class="mob" style="gap:8px;flex-wrap:wrap"><button class="chip" data-act="theme">${ic('moon', 14)}Theme</button><button class="chip" data-act="tgopen">${ic('send', 14)}Telegram ${store.tg.on && tgReady() ? 'on' : 'off'}</button><button class="chip" data-act="side">${ic('x', 14)}Close menu</button></div>
 ${typeof captureUI === 'function' && !OFFSITE ? captureUI() : scanUI()}
 <div><h4>${ic('sliders', 15)}Filters</h4>
  <label class="row"><span>Min discount</span><b>${store.minDisc}%</b></label><input type="range" min="0" max="90" step="5" value="${store.minDisc}" data-in="minDisc">
  <label class="row" style="margin-top:14px"><span>Max price</span><b>${store.maxPrice ? $inr(store.maxPrice) : 'Any'}</b></label><input type="range" min="0" max="2000" step="50" value="${store.maxPrice}" data-in="maxPrice">
  <label class="sw" style="margin-top:16px"><input type="checkbox" data-in="stockOnly" ${store.stockOnly ? 'checked' : ''}> In stock only</label>
  <label class="sw" style="margin-top:10px"><input type="checkbox" data-in="favOnly" ${S.favOnly ? 'checked' : ''}> Saved only</label>
  <label class="sw" style="margin-top:10px"><input type="checkbox" data-in="newOnly" ${S.newOnly ? 'checked' : ''}> New or price dropped</label></div>
 <div><h4>${ic('download', 15)}Export</h4><div class="chips"><button class="chip" data-act="csv">${ic('download', 14)}CSV</button><button class="chip" data-act="copyall">${ic('copy', 14)}Copy top 20</button><button class="chip" data-act="unhide">${ic('eyeoff', 14)}Unhide (${store.hidden.length})</button></div>
  <p class="note" style="margin-top:14px"><kbd>/</kbd> search &nbsp;<kbd>S</kbd> scan &nbsp;<kbd>Esc</kbd> close</p></div>
</aside>`;
  }
  function spark(p) {
    const pts = (store.hist[p.id] || []).map(x => x[1]);
    if (pts[pts.length - 1] !== p.price) pts.push(p.price);
    if (pts.length < 2) return '';
    const lo = Math.min(...pts), hi = Math.max(...pts), w = 64, h = 18, n = pts.length - 1;
    const xy = pts.map((v, i) => [Math.round(i / n * w), hi === lo ? h / 2 : Math.round(2 + (hi - v) / (hi - lo) * (h - 4))]);
    const last = xy[xy.length - 1];
    return `<div class="hist"><svg width="${w + 4}" height="${h}" viewBox="-2 0 ${w + 4} ${h}"><polyline points="${xy.map(a => a.join(',')).join(' ')}" fill="none" stroke="var(--pr)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${last[0]}" cy="${last[1]}" r="2.6" fill="var(--pr)"/></svg>Low ${$inr(lo)} · high ${$inr(hi)}</div>`;
  }
  function offsiteCard() {
    return `<div class="check"><h3>Open ${esc(PLATFORM)} to see live deals</h3><p class="note" style="font-size:14px">PriceDrop Hunter reads live prices inside your own ${esc(PLATFORM)} tab, so it can only fetch deals there.</p><p class="note" style="font-size:14px;margin-top:8px"><b>Userscript installed?</b> Hunter opens by itself on the store. <b>Using the bookmark?</b> After the store opens, tap your PriceDrop Hunter bookmark again on that page.</p><a class="btn" href="${STORE_URL}#pricedrop" target="_blank" rel="noopener" style="margin-top:16px;text-decoration:none">${ic('ext')}Open ${esc(PLATFORM)}</a></div>`;
  }
  function checklist() {
    const capture = typeof captureUI === 'function';
    const loc = typeof fkLocCheck === 'function' ? fkLocCheck() : (typeof P !== 'undefined' && P.locCheck ? P.locCheck() : null);
    const rows = [
      [true, 'You are on ' + PLATFORM, ''],
      [loc, 'Delivery location set', loc === false ? 'Set your delivery address on ' + PLATFORM + ', then reopen Hunter.' : 'Make sure your delivery address is set on ' + PLATFORM + '.'],
      [typeof GM_xmlhttpRequest === 'function' ? true : null, 'Userscript installed', 'Optional. Recommended for reliable Telegram alerts.'],
      [tgReady() ? true : null, 'Telegram connected', 'Optional. Press Telegram in the top bar to connect your bot.']
    ];
    return `<div class="check"><h3>Before your first ${capture ? 'capture' : 'scan'}</h3>${rows.map(([ok, t, hint]) => `<div class="ck ${ok ? 'ok' : ok === false ? 'no' : 'q'}"><span>${ic(ok ? 'check' : ok === false ? 'x' : 'info', 15)}</span><div><b>${t}</b>${!ok && hint ? `<p>${hint}</p>` : ''}</div></div>`).join('')}<button class="btn" data-act="scan" style="margin-top:16px">${ic('scan')}${capture ? 'Auto-scroll page' : 'Scan deals'}</button></div>`;
  }
  function card(p, fav, qtyMap) {
    const inList = qtyMap[p.id];
    return `<article class="card ${p.inStock ? '' : 'oos'}">
 <div class="im" style="background-image:url('${esc(String(p.img).replace(/'/g, '%27'))}')">
  <span class="dc ${p.disc >= 60 ? 'hot' : ''}">${p.disc}% OFF</span>${p.isNew ? '<span class="tg">New</span>' : p.lowEver ? `<span class="tg low">${ic('star', 11)}Lowest ever</span>` : p.was ? `<span class="tg">${ic('arrowdown', 11)}Price drop</span>` : ''}
  <button class="fv ${fav ? 'on' : ''}" data-act="fav" data-id="${esc(p.id)}" title="${fav ? 'Saved' : 'Save'}">${ic('heart', 17)}</button></div>
 <div class="inf"><a class="ti" ${p.url ? `href="${esc(p.url)}" target="_blank" rel="noopener"` : ''}>${esc(p.title)}</a>
  <div class="ct">${esc(p.cat)}</div>
  <div class="pr"><b>${$inr(p.price)}</b><s>${$inr(p.mrp)}</s></div>
  <div class="sv">Save ${$inr(p.save)}${p.inStock ? '' : ' · <i>Out of stock</i>'}</div>
  ${p.unit ? `<div class="up">${unitLabel(p)}</div>` : ''}
  ${spark(p)}
  <div class="acts"><button class="add ${inList ? 'in' : ''}" data-act="add" data-id="${esc(p.id)}">${inList ? ic('check', 16) + 'In list · ' + inList : ic('plus', 16) + 'Add to list'}</button><button class="hide" data-act="hide" data-id="${esc(p.id)}" title="Hide">${ic('eyeoff', 16)}</button></div></div></article>`;
  }
  const byDisc = (a, b) => b.disc - a.disc || b.save - a.save;
  function bestView(list) {
    if (!list.length) return '';
    const top = list.slice().sort(byDisc).slice(0, 12), fav = new Set(store.favs);
    const cats = new Map();
    for (const p of list) { const c = p.cat.split(' › ')[0]; if (!cats.has(c)) cats.set(c, []); cats.get(c).push(p); }
    const rows = [...cats.entries()].map(([c, ps]) => [c, ps.sort(byDisc)]).sort((x, y) => y[1][0].disc - x[1][0].disc);
    return `<section class="sec"><div class="sh"><h3>Biggest discounts right now</h3><span>${list.length} deals from ${cats.size} categories</span></div>
  <div class="grid">${top.map(p => card(p, fav.has(p.id), store.list)).join('')}</div></section>
 ${rows.map(([c, ps]) => `<section class="sec"><div class="sh"><h3>${esc(c)}</h3><button class="more" data-act="seeall" data-id="${esc(c)}">See all ${ps.length}${ic('ext', 13)}</button></div>
  <div class="hs">${ps.slice(0, 10).map(p => card(p, fav.has(p.id), store.list)).join('')}</div></section>`).join('')}`;
  }
  function mainView() {
    if (OFFSITE) return `<main id="main">${offsiteCard()}</main>`;
    if (!S.products.size && !S.scanning) return `<main id="main">${checklist()}</main>`;
    const list = filtered();
    const tabs = [['best', 'Best deals'], ['all', 'All deals'], ['saved', 'Saved' + (store.favs.length ? ' · ' + store.favs.length : '')]];
    const head = `<div class="tabs">${tabs.map(([k, l]) => `<button class="${S.tab === k ? 'on' : ''}" data-act="tab" data-v="${k}">${l}</button>`).join('')}${S.scanning ? `<span class="live">${ic('scan', 14)}Scanning ${S.done}/${S.total}</span>` : ''}</div>`;
    let body;
    if (S.tab === 'best') {
      body = bestView(list) || `<div class="empty"><span class="ei">${ic(S.scanning ? 'scan' : 'tag', 26)}</span><b>${S.scanning ? 'Finding the best deals…' : 'No deals at this discount'}</b>${S.scanning ? 'They appear here as each category comes in.' : 'Lower the minimum discount in the menu.'}</div>`;
    } else {
      const cats = [...new Set([...S.products.values()].map(p => p.cat.split(' › ')[0]))];
      const fav = new Set(store.favs);
      const tools = S.tab === 'all' ? `<div class="tools">
  <select data-in="cat"><option value="">All categories</option>${cats.map(c => `<option ${S.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
  <select data-in="sort">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}" ${store.sort === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select>
 </div>` : '';
      body = tools + (list.length ? `<div class="grid ${store.view}">${list.slice(0, S.shown).map(p => card(p, fav.has(p.id), store.list)).join('')}</div>
   ${list.length > S.shown ? `<div style="text-align:center;margin-top:24px"><button class="btn ghost" data-act="more">Show more (${list.length - S.shown} left)</button></div>` : ''}`
        : `<div class="empty"><span class="ei">${ic(S.tab === 'saved' ? 'heart' : 'tag', 26)}</span><b>${S.tab === 'saved' ? 'Nothing saved yet' : 'Nothing matches'}</b>${S.tab === 'saved' ? 'Tap the heart on any deal to keep an eye on it.' : 'Try another category or a lower minimum discount.'}</div>`);
    }
    return `<main id="main">${head}${body}</main>`;
  }
  function drawer() {
    const items = Object.entries(store.list).map(([id, q]) => [S.products.get(id) || store._cache && store._cache[id], q]).filter(x => x[0]);
    const tot = items.reduce((s, [p, q]) => s + p.price * q, 0), mrp = items.reduce((s, [p, q]) => s + p.mrp * q, 0);
    return `<div class="drawer ${S.panel ? 'open' : ''}"><header><b>${ic('bag', 20)}Shopping list</b><button class="hb" data-act="clearlist">Clear</button><button class="ib" data-act="closepanel" title="Close">${ic('x')}</button></header>
 <div class="dl">${items.length ? items.map(([p, q]) => `<div class="li"><img src="${esc(p.img)}" alt=""><div><a class="ti">${esc(p.title)}</a><b>${$inr(p.price * q)}</b><s>${$inr(p.mrp * q)}</s></div><div class="qty"><button data-act="dec" data-id="${esc(p.id)}">−</button>${q}<button data-act="inc" data-id="${esc(p.id)}">+</button></div></div>`).join('') : `<div class="empty"><span class="ei">${ic('bag', 26)}</span><b>Your list is empty</b>Tap “Add to list” on any deal.</div>`}</div>
 <div class="df"><div class="row"><span class="note">Total</span><span class="tot">${$inr(tot)}</span></div><div class="row"><span class="note">You save</span><b style="color:var(--ok);font-size:16px">${$inr(mrp - tot)}</b></div>
 <div class="row" style="gap:10px;margin-top:4px"><button class="btn ghost" style="flex:1" data-act="copylist">${ic('copy', 16)}Copy list</button><button class="btn" style="flex:1;height:40px;font-size:14px" data-act="openlinks">${ic('ext', 16)}Open all</button></div></div></div>`;
  }
  function render() {
    const dark = store.theme === 'dark' || (store.theme === 'auto' && matchMedia('(prefers-color-scheme:dark)').matches);
    const keepScroll = (root.getElementById('main') || {}).scrollTop || 0;
    const sideScroll = (root.querySelector('aside') || {}).scrollTop || 0;
    const focused = root.activeElement && root.activeElement.dataset ? root.activeElement.dataset.in : null;
    const count = Object.values(store.list).reduce((a, b) => a + b, 0);
    const pct = S.total ? Math.round(S.done / S.total * 100) : 0;
    const capture = typeof captureUI === 'function' && !OFFSITE;
    app.className = 'app' + (dark ? ' dark' : '');
    app.innerHTML = `<header><button class="ib menu-btn" data-act="side" title="Menu">${ic('menu')}</button>
 <div class="logo"><span class="mk">${ic('arrowdown', 20)}</span><div><b>PriceDrop Hunter</b><small>${esc(PLATFORM)}${OFFSITE ? '<span class="flag">Not on store</span>' : ''}</small></div></div>
 <label class="search">${ic('search', 17)}<input data-in="q" placeholder="Search products or brands" value="${esc(S.q)}"><kbd>/</kbd></label><span class="sp"></span>
 ${capture ? '' : S.scanning ? `<button class="sb stop" data-act="stop">${ic('stop', 16)}<span class="lb">Stop</span></button>` : `<button class="sb" data-act="scan">${ic('scan', 16)}<span class="lb">Scan</span></button>`}
 <button class="hb tgb" data-act="tgopen" title="Telegram alerts">${ic('send', 16)}<span class="lb">Telegram</span><span class="dot ${store.tg.on && tgReady() ? 'on' : ''}"></span></button>
 <button class="ib" data-act="theme" title="${dark ? 'Light' : 'Dark'} mode">${ic(dark ? 'sun' : 'moon')}</button>
 <button class="hb" data-act="panel" title="Shopping list">${ic('bag')}<span class="lb">List</span>${count ? `<span class="n">${count}</span>` : ''}</button>
 <button class="ib" data-act="close" title="Close (Esc)">${ic('x')}</button>${S.scanning ? `<div class="prog" style="width:${pct}%"></div>` : ''}</header>
 <div class="body">${sideOpen ? '<div class="scrim side" data-act="side"></div>' : ''}${sidebar()}${mainView()}</div>${S.panel ? '<div class="scrim" data-act="closepanel"></div>' : ''}${drawer()}${S.pick ? pickerUI() : ''}${S.tgm ? tgModal() : ''}<div class="toast" id="toast"></div>`;
    const m = root.getElementById('main'); if (m) m.scrollTop = keepScroll;
    const a = root.querySelector('aside'); if (a) a.scrollTop = sideScroll;
    if (focused === 'q') { const i = root.querySelector('[data-in=q]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  }
  let rq = 0;
  const scheduleRender = () => { if (rq) return; rq = setTimeout(() => { rq = 0; render(); }, 250); };
  let tt;
  function toast(msg) {
    const t = root.getElementById('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 3600);
  }
  async function copy(text, msg) {
    try { await navigator.clipboard.writeText(text); toast(msg || 'Copied'); }
    catch (e) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast(msg || 'Copied'); }
  }
  function listText() {
    const lines = Object.entries(store.list).map(([id, q]) => { const p = S.products.get(id) || (store._cache && store._cache[id]); return p ? `- ${p.title} x${q}: ${$inr(p.price * q)}${p.url ? '\n  ' + p.url : ''}` : null; }).filter(Boolean);
    return lines.join('\n');
  }
  // Add products from any source (scan, passive capture) with price-history flags.
  function ingest(items) {
    let fresh = 0;
    for (const p of items) {
      if (!allowed(p) || S.products.has(p.id)) continue;
      const prev = store.prices[p.id];
      p.isNew = prev == null; p.was = prev != null && prev > p.price ? prev : 0;
      p.unit = unitOf(p.title);
      const hs = store.hist[p.id];
      if (hs && hs.length) {
        const ps = hs.map(x => x[1]), lo = Math.min(...ps), hi = Math.max(...ps);
        p.low = Math.min(lo, p.price); p.lowEver = p.price < lo || (p.price === lo && hi > lo);
      }
      S.products.set(p.id, p); fresh++;
    }
    return fresh;
  }

  // ───────────────────────── Telegram alerts ─────────────────────────
  store.tg = Object.assign({ on: false, token: '', chat: '', minDisc: 60, drops: true, watch: true }, store.tg || {});
  store.sent = store.sent || {};
  const tgReady = () => !!(store.tg.token && store.tg.chat);
  async function tgSend(text) {
    const url = 'https://api.telegram.org/bot' + store.tg.token + '/sendMessage';
    // Form encoding keeps this a simple request: a JSON body triggers a CORS preflight that Telegram does not answer.
    const data = new URLSearchParams({ chat_id: store.tg.chat, text, parse_mode: 'HTML', disable_web_page_preview: 'true' }).toString();
    // Userscript: GM_xmlhttpRequest is not limited by the shop's Content-Security-Policy.
    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise((res, rej) => GM_xmlhttpRequest({
        method: 'POST', url, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, data,
        onload: r => { let j = {}; try { j = JSON.parse(r.responseText); } catch (e) { /* ignore */ } if (r.status === 200) res(); else rej(new Error(j.description || 'HTTP ' + r.status)); },
        onerror: () => rej(new Error('network error'))
      }));
    }
    let r;
    try { r = await W.fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: data }); }
    catch (e) { throw new Error('this site blocks direct requests to Telegram. Use the userscript version for alerts.'); }
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.description || 'HTTP ' + r.status); }
  }
  const tgLine = p => `<b>${p.disc}% off</b> · ${esc(p.title.slice(0, 90))}\n${$inr(p.price)} <s>${$inr(p.mrp)}</s>${p.was ? ' · was ' + $inr(p.was) : ''}${p.url ? `\n<a href="${esc(p.url)}">Open on ${esc(PLATFORM)}</a>` : ''}`;
  async function notify() {
    if (OFFSITE || !store.tg.on || !tgReady()) return;
    const fav = new Set(store.favs), out = [];
    S.products.forEach(p => {
      if (!p.inStock) return;
      const hit = p.disc >= store.tg.minDisc || (store.tg.drops && p.was) || (store.tg.watch && fav.has(p.id) && (p.was || store.favAt[p.id] > p.price));
      const last = store.sent[p.id];
      if (hit && (last == null || p.price < last)) out.push(p);
    });
    if (!out.length) return;
    out.sort(SORTS.score[1]);
    const top = out.slice(0, 12);
    const head = `<b>PriceDrop Hunter · ${esc(PLATFORM)}</b>\n${out.length} new deal${out.length > 1 ? 's' : ''}${out.length > top.length ? ', best ' + top.length + ' below' : ''}`;
    try {
      await tgSend(head + '\n\n' + top.map(tgLine).join('\n\n'));
      top.forEach(p => { store.sent[p.id] = p.price; });
      const ks = Object.keys(store.sent); if (ks.length > 4000) ks.slice(0, ks.length - 4000).forEach(k => delete store.sent[k]);
      save(); toast(`Sent ${top.length} deal${top.length > 1 ? 's' : ''} to Telegram`);
    } catch (e) { toast('Telegram: ' + e.message); }
  }
  const notifySoon = debounce(() => notify(), 4000);
  async function tgTest() {
    if (!tgReady()) { S.tgm = true; render(); toast('Paste your bot token and chat ID first'); return; }
    try { await tgSend(`<b>PriceDrop Hunter</b> is connected for ${esc(PLATFORM)}.\nDeals from ${store.tg.minDisc}% off will arrive here.`); toast('Test message sent. Check Telegram.'); }
    catch (e) { toast('Telegram: ' + e.message); }
  }
  // ───────────────────────── Events ─────────────────────────
  const reFilter = debounce(() => { S.shown = 60; render(); }, 150);
  root.addEventListener('input', e => {
    const k = e.target.dataset && e.target.dataset.in; if (!k) return;
    if (k === 'q') { S.q = e.target.value; reFilter(); return; }
    if (P.locInput(k, e.target.value)) return;
    if (k === 'tgToken' || k === 'tgChat') { store.tg[k === 'tgToken' ? 'token' : 'chat'] = e.target.value.trim(); save(); return; }
    if (k === 'tgMin') { store.tg.minDisc = +e.target.value; save(); const b = root.getElementById('tgminv'); if (b) b.textContent = store.tg.minDisc + '% off'; return; }
    if (k === 'depth' || k === 'minDisc' || k === 'maxPrice') { store[k] = +e.target.value; save(); S.shown = 60; render(); return; }
  });
  root.addEventListener('change', e => {
    const k = e.target.dataset && e.target.dataset.in; if (!k) return;
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (k === 'tgOn' || k === 'tgDrops' || k === 'tgWatch') {
      store.tg[{ tgOn: 'on', tgDrops: 'drops', tgWatch: 'watch' }[k]] = v; save(); render();
      if (k === 'tgOn' && v && !tgReady()) toast('Add your bot token and chat ID too');
      return;
    }
    if (k === 'stockOnly') { store.stockOnly = v; save(); }
    else if (k === 'sort') { store.sort = v; save(); }
    else if (k === 'favOnly') S.favOnly = v; else if (k === 'newOnly') S.newOnly = v;
    else if (k === 'cat') S.cat = v; else if (k === 'brand') S.brand = v;
    else return;
    S.shown = 60; render();
  });
  root.addEventListener('click', e => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const a = el.dataset.act, id = el.dataset.id;
    store._cache = store._cache || {};
    switch (a) {
      case 'close': api.hide(); break;
      case 'theme': store.theme = app.classList.contains('dark') ? 'light' : 'dark'; save(); render(); break;
      case 'side': sideOpen = !sideOpen; render(); break;
      case 'panel': S.panel = !S.panel; render(); break;
      case 'closepanel': S.panel = false; render(); break;
      case 'grp': store.groups = store.groups.includes(id) ? store.groups.filter(x => x !== id) : store.groups.concat(id); save(); render(); break;
      case 'all': store.groups = GROUPS.map(g => g.id); save(); render(); break;
      case 'none': store.groups = []; save(); render(); break;
      case 'scan': openPicker(); break;
      case 'pstart': if (!store.groups.length) { toast('Pick at least one category'); break; } S.pick = false; render(); scan(); break;
      case 'pclose': S.pick = false; render(); break;
      case 'stop': S.ctl.stop = true; toast('Stopping…'); break;
      case 'autoscroll': if (typeof autoScroll === 'function') autoScroll(); break;
      case 'tgtest': tgTest(); break;
      case 'bell': case 'tgopen': sideOpen = false; S.pick = false; S.tgm = true; render(); break;
      case 'tgclose': S.tgm = false; render(); break;
      case 'view': store.view = el.dataset.v; save(); render(); break;
      case 'more': S.shown += 60; render(); break;
      case 'fav':
        if (store.favs.includes(id)) { store.favs = store.favs.filter(x => x !== id); delete store.favAt[id]; }
        else { store.favs = store.favs.concat(id); const p = S.products.get(id); if (p) store.favAt[id] = p.price; }
        save(); render(); break;
      case 'preset': S.preset = S.preset === id ? '' : id; S.shown = 60; render(); break;
      case 'tab': S.tab = el.dataset.v; S.shown = 60; if (S.tab !== 'all') S.cat = ''; render(); { const m = root.getElementById('main'); if (m) m.scrollTop = 0; } break;
      case 'seeall': S.tab = 'all'; S.cat = id; S.shown = 60; render(); { const m = root.getElementById('main'); if (m) m.scrollTop = 0; } break;
      case 'hide': store.hidden.push(id); save(); render(); toast('Hidden — undo via Data › Unhide'); break;
      case 'unhide': store.hidden = []; save(); render(); break;
      case 'add': store.list[id] = (store.list[id] || 0) + 1; { const p = S.products.get(id); if (p) store._cache[id] = p; } save(); render(); break;
      case 'inc': store.list[id]++; save(); render(); break;
      case 'dec': if (--store.list[id] <= 0) delete store.list[id]; save(); render(); break;
      case 'clearlist': store.list = {}; save(); render(); break;
      case 'copylist': copy(listText() || 'Empty list', 'List copied'); break;
      case 'openlinks': Object.keys(store.list).map(i => S.products.get(i)).filter(p => p && p.url).forEach(p => window.open(p.url, '_blank', 'noopener')); break;
      case 'copyall': copy(filtered().slice(0, 20).map(p => `${p.disc}% off · ${p.title} · ${$inr(p.price)} (MRP ${$inr(p.mrp)})${p.url ? '\n' + p.url : ''}`).join('\n'), 'Top 20 deals copied'); break;
      case 'csv': {
        const rows = [['Title', 'Brand', 'Category', 'Price', 'MRP', 'Discount %', 'Saving', 'In stock', 'URL']].concat(filtered().map(p => [p.title, p.brand, p.cat, p.price, p.mrp, p.disc, p.save, p.inStock, p.url]));
        const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
        const a2 = document.createElement('a'); a2.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a2.download = 'jiomart-deals.csv'; a2.click(); toast('CSV downloaded'); break;
      }
    }
  });
  document.addEventListener('keydown', e => {
    if (host.style.display === 'none') return;
    const typing = root.activeElement && /INPUT|SELECT/.test(root.activeElement.tagName);
    if (e.key === 'Escape' && (S.pick || S.tgm)) { S.pick = false; S.tgm = false; render(); }
    else if (e.key === 'Escape') { if (S.panel) { S.panel = false; render(); } else if (typing) root.activeElement.blur(); else api.hide(); }
    else if (!typing && !e.metaKey && !e.ctrlKey) {
      if (e.key === '/') { e.preventDefault(); const i = root.querySelector('[data-in=q]'); i && i.focus(); }
      else if (e.key.toLowerCase() === 's') S.scanning ? (S.ctl.stop = true) : openPicker();
    }
    if (!typing || e.key === 'Escape') e.stopPropagation();
  }, true);

  // ───────────────────────── Public API ─────────────────────────
  let prevOverflow = '';
  const api = {
    show() { host.style.display = 'block'; if (!OFFSITE && !S.scanning && !S.products.size && typeof captureUI !== 'function') setTimeout(openPicker, 300); prevOverflow = document.documentElement.style.overflow; document.documentElement.style.overflow = 'hidden'; render(); },
    hide() { host.style.display = 'none'; document.documentElement.style.overflow = prevOverflow; },
    toggle() { host.style.display === 'none' ? api.show() : api.hide(); }
  };
  window.__JMQ__ = api;
  document.body.appendChild(host);
  api.show();
  if (typeof P !== 'undefined' && P.install && !OFFSITE) P.install(ingest);
})();
