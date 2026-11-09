// Power-features tests for v2.1.0 — every "better than baseline" feature in
// src/deals.js, tested against the real code (extracted + evaluated, same
// technique as test-results-tab.js) and the sample fixture.
// Run from the repo root: `node test/power-features.test.js`
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'deals.js'), 'utf8');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'sample-api.json'), 'utf8'));

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
  extract('function normalise(x, cat) {', '\n  async function fetchPage'),
  extract('const UNITS = ', ';\n  function unitOf'),
  extract('function unitOf(t) {', '\n  const r1 = '),
  extract('const unitVal = ', ';\n'),
  extract('function matchQuery(p, q) {', '\n  // v2.1 de-dupe'),
  extract('function dedupeById(items) {', '\n  const score = '),
  extract('function emptyReason(d, hasPin, minDisc) {', '\n  const locDetail'),
  extract('const SELFTEST_FIXTURE = [', '\n  function runSelfTest'),
  extract('function runSelfTest() {', '\n  function selftestUI')
].join('\n');
eval(helpers); // defines price, normalise, unitOf, matchQuery, dedupeById, emptyReason, runSelfTest
// `const` inside eval() does not leak to module scope, so pull unitVal out explicitly.
eval(helpers + '\n;module.exports.__unitVal = unitVal;');
const unitVal = module.exports.__unitVal;

const parsed = fixture.items.map(x => normalise(x, 'Cooking Essentials')).filter(Boolean);
parsed.forEach(p => { p.unit = unitOf(p.title); });
const byId = id => parsed.find(p => p.id === id);

let pass = 0, fail = 0;
function check(name, ok) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name);
  if (ok) pass++; else fail++;
}

// ── 1. Multi-keyword search (commas = OR, words in a group = AND) ──
check('matchQuery: single word matches (atta)', matchQuery(byId('JM001'), 'atta'));
check('matchQuery: brand is searchable (aashirvaad)', matchQuery(byId('JM001'), 'aashirvaad'));
check('matchQuery: comma = OR, first side (atta, rice) hits atta', matchQuery(byId('JM001'), 'atta, rice'));
check('matchQuery: comma = OR, second side (atta, rice) hits rice', matchQuery(byId('JM005'), 'atta, rice'));
check('matchQuery: no comma = AND, so (rice shampoo) hits neither', !matchQuery(byId('JM005'), 'rice shampoo') && !matchQuery(byId('JM004'), 'rice shampoo'));
check('matchQuery: two words in one group both match (basmati rice)', matchQuery(byId('JM005'), 'basmati rice'));
check('matchQuery: empty query matches everything', matchQuery(byId('JM001'), ''));

// ── 2. Unit-price parsing (feeds the value sort + best-value row) ──
const u1 = unitOf('Chakki Atta 5 kg');
check('unitOf: "Atta 5 kg" -> 5 kg', !!u1 && u1.base === 'kg' && u1.qty === 5);
const u2 = unitOf('Toned Milk 1 L');
check('unitOf: "Milk 1 L" -> 1 L', !!u2 && u2.base === 'L' && u2.qty === 1);
const u3 = unitOf('Green Tea 100g');
check('unitOf: "Tea 100g" -> 0.1 kg', !!u3 && u3.base === 'kg' && Math.abs(u3.qty - 0.1) < 1e-9);
const u4 = unitOf('Oil 2 x 1 L');
check('unitOf: "2 x 1 L" -> 2 L', !!u4 && u4.base === 'L' && u4.qty === 2);

// ── 3. Cross-page/category de-dupe ──
const dupes = dedupeById([
  { id: 'JM001', disc: 40, save: 100 },
  { id: 'JM001', disc: 55, save: 231 },
  { id: 'JM002', disc: 63, save: 75 }
]);
check('dedupeById: same id twice collapses to one row', dupes.length === 2);
check('dedupeById: keeps the best discount (55%, not 40%)', dupes.find(p => p.id === 'JM001').disc === 55);

// ── 4. Empty-state diagnostics: each cause named distinctly ──
check('emptyReason: no pincode -> pincode message', /pincode/i.test(emptyReason({}, false).title));
check('emptyReason: login page -> signed-out message', /signed out/i.test(emptyReason({ loginPage: true }, true).title));
check('emptyReason: 401/403 -> refused message', /401\/403/.test(emptyReason({ authFail: true }, true).hint));
check('emptyReason: 429 -> rate-limit message', /rate-limit/i.test(emptyReason({ rateLimited: true }, true).title));
check('emptyReason: rows returned, none parsed -> unreadable message', /unreadable/i.test(emptyReason({ fetched: 10, parsed: 0 }, true).title));
check('emptyReason: zero rows -> empty-category message', /returned nothing/i.test(emptyReason({ fetched: 0, parsed: 0 }, true).title));
check('emptyReason: rows parsed but filtered -> filters message with min %', (() => { const r = emptyReason({ fetched: 10, parsed: 10 }, true, 30); return /filters/i.test(r.title) && /30%/.test(r.hint); })());

// ── 5. Built-in self-test (same cases the in-browser button runs) ──
const self = runSelfTest();
check('runSelfTest: all 8 bundled checks pass', self.length === 8 && self.every(c => c.ok));
if (!self.every(c => c.ok)) self.filter(c => !c.ok).forEach(c => console.log('  failed self-test case:', c.name));

// ── 6. Cross-category best-value row: cheapest per kg wins ──
const kg = parsed.filter(p => p.unit && p.unit.base === 'kg').sort((a, b) => unitVal(a) - unitVal(b));
check('best-value: cheapest per kg is Atta 5 kg at Rs 37.8/kg', kg.length > 0 && kg[0].id === 'JM001' && Math.abs(unitVal(kg[0]) - 37.8) < 0.01);

// ── 7. Highest-discount regression (2026-11-09) ──
// The old mrp > sell * 20 guard dropped every genuine 96–99% clearance
// item; items with no MRP parsed at 0% off and vanished under minDisc.
const hdFixture = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'sample-high-discount.json'), 'utf8'));
const hdParsed = hdFixture.items.map(x => normalise(x, 'Cooking Essentials')).filter(Boolean);
const hdById = id => hdParsed.find(p => p.id === id);
check('high-discount: 96% off parses (HD04)', !!hdById('HD04') && hdById('HD04').disc === 96);
check('high-discount: 99% off parses and is the highest (HD06)', !!hdById('HD06') && hdById('HD06').disc === 99 && hdParsed.every(p => p.disc <= 99));
check('high-discount: no-MRP + explicit discount parses (HD08, 90%)', !!hdById('HD08') && hdById('HD08').disc === 90);
check('high-discount: 99.5% off still rejected as inflated MRP (HD07)', !hdById('HD07'));
check('high-discount: clearance with empty sizes parses, flagged out of stock (HD12)', !!hdById('HD12') && hdById('HD12').inStock === false);

console.log('Checks passed: ' + pass + ' / ' + (pass + fail));
if (fail) {
  console.log('FAIL: power-features — ' + fail + ' check(s) failed');
  process.exit(1);
}
console.log('PASS: power features — ' + pass + ' of ' + pass + ' checks passed (multi-keyword search, unit prices, dedupe, diagnostics, self-test, best-value row, highest-discount)');
