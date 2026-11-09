// Regression test for the blank-results bug class (v2.0.0).
// Fixture (fixtures/sample-api.json) -> parser (normalise from src/deals.js)
// -> rendered cards. Rendered card count must equal the number of valid
// products in the fixture. Run from the repo root: `node test-results-tab.js`
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'src', 'deals.js'), 'utf8');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'sample-api.json'), 'utf8'));

// Extract the parser and its helpers out of src/deals.js and evaluate them
// here. They only reference each other, so this tests the real code.
function extract(startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  const end = endMarker ? src.indexOf(endMarker, start) : -1;
  if (start < 0 || (endMarker && end < 0)) throw new Error('could not find ' + startMarker);
  return src.slice(start, end < 0 ? undefined : end);
}
const discPctSrc = src.indexOf('const discPctOf = ') < 0 ? 'const discPctOf = () => 0;' : extract('const discPctOf = ', ';\n');
const helpers = [
  extract('const price = ', ';\n  // v2:'),
  extract('const priceField = ', ';\n'),
  discPctSrc,
  extract('const brandOf = ', ';\n'),
  extract('const imgOf = ', ';\n'),
  extract('const guessBrand = ', ';\n'),
  extract('function normalise(x, cat) {', '\n  async function fetchPage')
].join('\n');
eval(helpers); // defines price, priceField, brandOf, imgOf, guessBrand, normalise

const raw = fixture.items || [];
const parsed = raw.map(x => normalise(x, 'Cooking Essentials')).filter(Boolean);

// Minimal render step, mirroring the real card(): one <article class="card">
// per parsed product, with title, price, discount, image and product URL.
function renderCard(p) {
  return '<article class="card"><div class="im" style="background-image:url(\'' + p.img + '\')">' +
    '<span class="dc">' + p.disc + '% OFF</span></div><div class="inf">' +
    '<a class="ti" href="' + p.url + '">' + p.title + '</a>' +
    '<div class="pr"><b>₹' + p.price + '</b><s>₹' + p.mrp + '</s></div></div></article>';
}
const gridHtml = parsed.map(renderCard).join('');
const cards = (gridHtml.match(/<article class="card/g) || []).length;

console.log('Fixture raw items:', raw.length);
console.log('Parsed (valid) products:', parsed.length);
console.log('Cards rendered:', cards);
console.log('First product:', parsed[0] && parsed[0].title, '| price ₹' + (parsed[0] && parsed[0].price), '| disc ' + (parsed[0] && parsed[0].disc) + '%');
console.log('Min-only (legacy) product parsed?', !!parsed.find(p => p.id === 'JM008') && parsed.find(p => p.id === 'JM008').price === 349);
console.log('Flat-number price product parsed?', !!parsed.find(p => p.id === 'JM009') && parsed.find(p => p.id === 'JM009').price === 149);
console.log('Image URL built?', parsed.every(p => p.img.indexOf('https://www.jiomart.com/images/') === 0));
console.log('Product URLs built?', parsed.every(p => p.url.indexOf('https://www.jiomart.com/product/') === 0));
console.log('Discounts correct?', parsed.find(p => p.id === 'JM001').disc === 55 && parsed.find(p => p.id === 'JM002').disc === 63);
console.log('Inflated-MRP item rejected?', !parsed.find(p => p.id === 'JM011'));
console.log('No-price item rejected?', !parsed.find(p => p.id === 'JM012'));
console.log('Out-of-stock check: sellable-only fallback still in stock?', parsed.find(p => p.id === 'JM001').inStock === true);

if (cards === parsed.length && parsed.length === 10) {
  console.log('PASS: 10 of 10 valid products render as cards (12 raw, 2 correctly rejected)');
} else {
  console.log('FAIL: expected 10 cards from 10 valid products, got ' + cards + ' cards from ' + parsed.length + ' parsed');
  process.exit(1);
}

// ── Highest-discount regression (2026-11-09) ──────────────────────────
// Fixture (fixtures/sample-high-discount.json) -> parser -> Best view.
// Before the fix the 96–99% items never parsed (the old mrp > sell * 20
// guard dropped them) and the no-MRP items parsed at 0% off, so the
// highest discount the Best tab could ever show was 95% — the 99% item
// was invisible. Now the highest-discount item must parse AND render first.
const hdFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'sample-high-discount.json'), 'utf8'));
const hdRaw = hdFixture.items || [];
const hdParsed = hdRaw.map(x => normalise(x, 'Cooking Essentials')).filter(Boolean);
const hdById = id => hdParsed.find(p => p.id === id);
// Same comparator the Best view uses (bestView sorts byDisc, top 12).
const byDisc = (a, b) => b.disc - a.disc || b.save - a.save;
// Same default filter the Best tab applies: in stock only, min discount 30%.
const hdVisible = hdParsed.filter(p => p.inStock && p.disc >= 30).sort(byDisc);
const hdGridHtml = hdVisible.map(renderCard).join('');
const hdCards = (hdGridHtml.match(/<article class="card/g) || []).length;
const hdFirstCard = hdGridHtml.slice(0, hdGridHtml.indexOf('</article>') + 10);

let hdFail = 0;
function hdCheck(name, ok) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name);
  if (!ok) hdFail++;
}
console.log('High-discount fixture raw items:', hdRaw.length);
console.log('High-discount parsed (valid) products:', hdParsed.length);
hdCheck('96% off parses (HD04, ₹40 vs ₹1,000)', !!hdById('HD04') && hdById('HD04').disc === 96);
hdCheck('98% off parses (HD05, ₹20 vs ₹1,000)', !!hdById('HD05') && hdById('HD05').disc === 98);
hdCheck('99% off parses (HD06, ₹10 vs ₹1,000)', !!hdById('HD06') && hdById('HD06').disc === 99);
hdCheck('96% min-only parses (HD16, ₹40 vs ₹1,000)', !!hdById('HD16') && hdById('HD16').disc === 96);
hdCheck('No-MRP + explicit "90%" discount parses (HD08)', !!hdById('HD08') && hdById('HD08').disc === 90);
hdCheck('No-MRP + float discount 87.5 parses (HD09, rounds to 88)', !!hdById('HD09') && hdById('HD09').disc === 88);
hdCheck('String MRP "₹1,999" parses (HD10, 90% off)', !!hdById('HD10') && hdById('HD10').disc === 90);
hdCheck('Top-level MRP field parses (HD14, 90% off)', !!hdById('HD14') && hdById('HD14').disc === 90);
hdCheck('Price-level discount field parses (HD15, 85% off)', !!hdById('HD15') && hdById('HD15').disc === 85);
hdCheck('99.5% off still rejected as inflated MRP (HD07, ₹5 vs ₹999)', !hdById('HD07'));
hdCheck('Clearance + empty sizes still parses, flagged out of stock (HD12)', !!hdById('HD12') && hdById('HD12').inStock === false);
hdCheck('Sellable=false still parses, flagged out of stock (HD13)', !!hdById('HD13') && hdById('HD13').inStock === false);
hdCheck('15 of 16 high-discount items parse (only HD07 rejected)', hdParsed.length === 15);
hdCheck('Highest-discount item renders FIRST in Best order (HD06, 99%)', hdVisible.length > 0 && hdVisible[0].id === 'HD06' && hdVisible[0].disc === 99);
hdCheck('96–99% items all inside the Best top 12', ['HD04', 'HD05', 'HD06', 'HD16'].every(id => hdVisible.slice(0, 12).some(p => p.id === id)));
hdCheck('First rendered card is the 99% item', hdCards === hdVisible.length && hdFirstCard.indexOf('99% OFF') >= 0 && hdFirstCard.indexOf('Year-End Chocolates') >= 0);
if (hdFail) {
  console.log('FAIL: highest-discount regression — ' + hdFail + ' check(s) failed');
  process.exit(1);
}
console.log('PASS: highest-discount items render, 99% first (15 of 16 parse, only the 99.5% inflated-MRP item rejected)');
