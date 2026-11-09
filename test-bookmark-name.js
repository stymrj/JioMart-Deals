// Regression test: the install-page bookmarklet button must be named after
// its store. Browsers name a dragged bookmark after the link text, so a
// generic "PriceDrop Hunter" label made every tool's bookmark identical.
// Usage: node test-bookmark-name.js
const fs = require('fs'), path = require('path');
const EXPECTED = 'JioMart Deals';
function bmText(html) {
  // The #bm href holds a whole bookmarklet, whose code contains '>' and
  // '</a>' sequences, so a plain regex cannot find the end of the opening
  // tag. Scan from the '<a' tracking double-quote state instead: the
  // attribute values contain no literal '"' (build.js escapes them), so
  // the first '>' outside quotes ends the opening tag.
  const i = html.indexOf('id="bm"');
  if (i < 0) throw new Error('no #bm install button found');
  const aStart = html.lastIndexOf('<a', i);
  let j = aStart, inQ = false;
  for (; j < html.length; j++) {
    const c = html[j];
    if (c === '"') inQ = !inQ;
    else if (c === '>' && !inQ) break;
  }
  const close = html.indexOf('</a>', j);
  if (close < 0) throw new Error('no closing </a> for #bm button');
  return html.slice(j + 1, close).replace(/<[^>]+>/g, '').trim();
}
let fail = 0;
for (const f of ['src/index.tpl.html', 'index.html']) {
  const p = path.join(__dirname, f);
  const got = bmText(fs.readFileSync(p, 'utf8'));
  if (got !== EXPECTED) { console.error(`FAIL ${f}: bookmark button is ${JSON.stringify(got)}, expected ${JSON.stringify(EXPECTED)}`); fail = 1; }
  else console.log(`ok ${f}: bookmark button is ${JSON.stringify(got)}`);
}
if (fail) process.exit(1);
console.log('PASS: bookmark name is per-store in template and built page');
