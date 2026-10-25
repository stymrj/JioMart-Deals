// Builds dist/ (bookmarklet, mobile loader, userscript) and index.html (from src/index.tpl.html).
// Usage: node build.js   (uses terser if available via npx, else ships unminified)
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const PAGES = 'https://stymrj.github.io/JioMart-Deals/';
// Some stores block fetching code from other sites; there the "mobile" copy is the full bookmarklet.
const LOADER_OK = true;
const src = path.join(__dirname, 'src/deals.js');
let code = fs.readFileSync(src, 'utf8');
// The stylesheet is a template string, so terser leaves it alone: squeeze its whitespace first.
code = code.replace(/(const CSS = `)([\s\S]*?)(`;)/, (_, a, css, b) => a + css.replace(/\s*\n\s*/g, '').replace(/\s*([{};,>])\s*/g, '$1').replace(/;}/g, '}') + b);
try {
  code = execSync('npx --yes terser --compress --mangle', { input: code, encoding: 'utf8', maxBuffer: 1 << 24, stdio: ['pipe', 'pipe', 'ignore'] });
  console.log('minified with terser');
} catch (e) {
  code = code.replace(/^\s*\/\/.*$/gm, '').replace(/\n\s*\n/g, '\n');
  console.log('terser unavailable, comments stripped only');
}
// Only `%` (decoded by the browser) and `#` (starts a URL fragment) must be escaped in a javascript: URL.
const toUrl = js => 'javascript:' + js.replace(/%/g, '%25').replace(/#/g, '%23').replace(/\r?\n/g, '%0A');
const bookmarklet = toUrl('(function(){' + code + '})()');
// Mobile loader: a few hundred characters that fetch the latest build from GitHub Pages.
const loader = !LOADER_OK ? bookmarklet : toUrl("(function(){if(window.__JMQ__)return window.__JMQ__.toggle();fetch('" + PAGES + "dist/deals.js?'+Date.now()).then(function(r){if(!r.ok)throw Error('HTTP '+r.status);return r.text()}).then(function(t){(0,eval)(t)}).catch(function(e){alert('PriceDrop Hunter could not load: '+e.message+'. Try the full bookmarklet or the userscript.')})})()");
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist/bookmarklet.txt'), bookmarklet);
fs.writeFileSync(path.join(__dirname, 'dist/loader.txt'), loader);
fs.writeFileSync(path.join(__dirname, 'dist/deals.js'), code);
// Tampermonkey/Violentmonkey build: loads quietly, adds a floating launcher button.
const header = `// ==UserScript==
// @name         PriceDrop Hunter for JioMart
// @namespace    jiomart-deals
// @version      2.0.0
// @description  Scan JioMart by category, sorted by discount, and see the biggest deals first.
// @match        https://www.jiomart.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      api.telegram.org
// ==/UserScript==
`;
const launcher = `
(function(){
  if(!window.__JMQ__) return;
  // Opened from the install page (#pricedrop): show Hunter straight away.
  if(/pricedrop/.test(location.hash)){ history.replaceState(null,'',location.pathname+location.search); return; }
  window.__JMQ__.hide();
  var b=document.createElement('button');
  b.textContent='PriceDrop';
  b.setAttribute('aria-label','Open PriceDrop Hunter');
  b.style.cssText='position:fixed;right:14px;bottom:calc(14px + env(safe-area-inset-bottom));z-index:2147483646;background:#0078ad;color:#fff;font:700 14px system-ui,sans-serif;border:0;border-radius:999px;padding:12px 18px;box-shadow:0 4px 16px rgba(0,0,0,.3);cursor:pointer';
  b.onclick=function(){window.__JMQ__.toggle()};
  document.body.appendChild(b);
})();
`;
fs.writeFileSync(path.join(__dirname, 'dist/jiomart-deals.user.js'), header + code + '\n' + launcher);
const attr = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const tpl = fs.readFileSync(path.join(__dirname, 'src/index.tpl.html'), 'utf8');
// Function replacements: a string would treat `$&` / `$'` inside the code as patterns.
fs.writeFileSync(path.join(__dirname, 'index.html'), tpl.replace('__BOOKMARKLET__', () => attr(bookmarklet)).replace('__LOADER__', () => attr(loader)));
console.log('bookmarklet:', (bookmarklet.length / 1024).toFixed(1), 'KB · mobile loader:', loader.length, 'chars');
