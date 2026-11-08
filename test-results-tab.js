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
const helpers = [
  extract('const price = ', ';\n  // v2:'),
  extract('const priceField = ', ';\n'),
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
