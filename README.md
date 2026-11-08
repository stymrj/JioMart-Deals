# PriceDrop Hunter for JioMart

Scans the JioMart categories you pick, sorted by discount, and shows the biggest deals. It runs in your own browser as a bookmarklet or userscript. Nothing is uploaded and there is no account.

**Live page:** https://stymrj.github.io/JioMart-Deals/

**Version:** 2.1.0 (8 November 2026) — see [CHANGELOG.md](CHANGELOG.md).

## Why v2 is stronger

The v2 port fixed the fetch layer; v2.1 goes further than the baseline in ways the other store tools do not have yet:

- **It tells you why 0 results happened.** A scan that finds nothing now names the cause — no pincode set, signed out, rate-limited (HTTP 429), JioMart server error, an empty category, products that came back unreadable, or deals that exist but are all filtered out by your minimum discount — with what to do about each. The baseline only showed an empty grid.
- **Built-in self-test.** A **Self-test** button in the menu runs the real parser on bundled samples (max-only, min-only and flat prices; inflated-MRP and no-price rejects; unit-price parsing) with no network, so you can check the tool itself before spending a scan.
- **Retries with exponential backoff.** A 429 or 5xx no longer kills the scan: each page retries up to 4 times (0.7s, 1.4s, 2.8s, 5.6s + jitter).
- **Deeper scans, with progress.** Default depth is 3 pages per category (up from 2), up to 6 pages, plus a one-tap **Deep scan** (all 20 categories, 5 pages each, scanned in parallel) with a live per-page progress readout. Results are de-duplicated across pages and categories, keeping the best discount per product.
- **Cross-category best-value row.** Beside the biggest-%-off grid, a "Best value per kg / litre" row ranks the cheapest unit price across every category scanned — a cheap staple no longer loses to a high-%-off snack.
- **Multi-keyword search.** Search `atta, rice` to match either (comma = or); words without a comma must all match. Brand names are searchable too.
- **Bot: multi-pincode + exports.** `bot-v2/` scans several pincodes in one run (`--pincode 560045 --pincode 110001`, or `JIOMART_PINCODES`), diffing each against its own price history, and `--export csv|json` writes every fetched product to `exports/` for spreadsheets or cross-store comparison.

## What it does

- Asks which categories to scan, then shows the biggest discounts first
- Best deals of each category in one swipeable row, with See all
- Ranks by percent off and rupees saved together
- Labels products that are new, cheaper than last time, or at their lowest price ever
- Price history sparkline on every product you have seen before
- Saved items strip showing how much each one dropped since you saved it
- Unit price (per kg, litre or piece) with a value sort
- One-tap presets: under ₹99, 50% off, save ₹100+, price drops, lowest ever, best value
- A setup checklist on first open
- Filters: search, category, brand, maximum price, minimum discount, stock, saved items
- Shopping list with quantities, total and total savings
- CSV export and copy-to-share text
- Grid and list views, light and dark themes, keyboard shortcuts
- Settings, saved items and price history stay in your browser

## What changed in v2

- **Fetch layer rewritten for the current JioMart API shape.** Scans now use the Vertex product endpoint (`/ext/vertex/application/api/v1.0/products`, `sort_on=discount_dsc`, 50 per page) with store routing from the delivery-promise API (store IDs + polygon IDs resolved once per scan from your pincode), and fall back to the older catalogue endpoint if Vertex answers 401/403/404. No token is embedded in the bookmarklet — it runs in your own signed-in session.
- **Blank-results bug fixed.** Prices are now read max-first (`price.effective.max`, falling back to `.min` and flat numbers). Previously a payload carrying only `max` parsed as ₹0 and every product was dropped, so a successful fetch showed an empty grid. A regression test (`node test-results-tab.js`) proves 10 of 10 valid fixture products render as cards.
- **Stock check corrected.** A product counts as in stock when it is sellable *and*, when the API reports in-stock variants, at least one size is listed. When the API omits variant data, sellable alone decides — so older responses no longer hide everything.
- **Clearer empty states.** If JioMart returns a login page instead of data, or rows the parser cannot read, the scan now says so in a toast instead of showing a silent empty grid.
- **New Python Telegram bot (`bot-v2/`).** Fetcher + SQLite history + deal differ + Telegram notifier, runnable on your own machine or a free host. Sends only new deals, price drops, restocks and discount increases (7-day cooldown for unchanged deals). See [Bot setup](#bot-setup-telegram-alerts-around-the-clock) below.
- **Install video:** [watch the walkthrough (MP4)](https://stymrj.github.io/PriceDrop-Hunter/media/install-demo.mp4) · [GIF](https://stymrj.github.io/PriceDrop-Hunter/media/install-demo.gif)

## Self-test (no network needed)

Open Hunter, press **Self-test** in the menu. It runs the real parser on bundled samples — max-only, min-only and flat-number prices, an inflated-MRP reject, a no-price reject, and unit-price parsing — and shows 6 of 6 checks passed when the tool is healthy. If a check fails after a JioMart site change, that is the first sign the parser needs an update, before you waste a scan.

## Install

**Bookmarklet (desktop).** Run `node build.js`, open `index.html`, and drag the button to your bookmarks bar. Open jiomart.com and click the bookmark.

**Bookmarklet (mobile).** On the install page, tap **Copy mobile loader**. It is a bookmark of about 380 characters that loads the latest version from GitHub Pages, so it fits on any phone. Create a bookmark, paste it as the address, and run it from the address bar on jiomart.com. The full bookmarklet (about 45 KB, no network needed) is in `dist/bookmarklet.txt`.

**Userscript.** Install `dist/jiomart-deals.user.js` in Tampermonkey or Violentmonkey. A small Deals button appears on every jiomart.com page.

**jsDelivr loader (bookmarklet):**

```javascript
javascript:(function(){var s=document.createElement('script');s.src='https://cdn.jsdelivr.net/gh/stymrj/JioMart-Deals@v2/dist/deals.js?t='+Date.now();document.body.appendChild(s);})()
```

## Use

1. Open jiomart.com and set your delivery pincode.
2. Click the bookmark (or the floating Deals button with the userscript).
3. Press **Scan**, pick categories, set pages per category.
4. Best deals appear first; use filters, presets, or the tabs (Best / All / Saved).
5. Tap the heart to save a deal, **Add to list** to build a shopping list, **CSV** to export.

Keyboard shortcuts: `/` search, `S` scan or stop, `Esc` close.

## Telegram alerts (in the browser)

Hunter can send new deals, price drops and cheaper saved items to your Telegram.

1. In Telegram, open `@BotFather`, send `/newbot`, and copy the bot token.
2. Open your new bot and press **Start**.
3. Get your chat ID from `@userinfobot`, or open `https://api.telegram.org/bot<token>/getUpdates` and copy `chat.id`.
4. On the store, open Hunter, press **Telegram** in the top bar, paste the token and chat ID, press **Send test**, then switch alerts on.

Each deal is sent once, and again only if its price drops further. Use the userscript for alerts: some shops block bookmarklets from calling Telegram, while the userscript sends through `GM_xmlhttpRequest`. The token is stored only in your browser.

## Bot setup (Telegram alerts around the clock)

`bot-v2/` is a standalone Python bot — no browser needed after setup.

```bash
cd bot-v2
pip install -r requirements.txt
cp .env.example .env   # then fill in TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, JIOMART_PINCODE
python bot.py --once --dry-run        # test: fetch + diff, send nothing
python bot.py --once                  # one scan, sends new deals to Telegram
python bot.py --once --pincode 560045 --pincode 110001 --export csv   # two pincodes + CSV export
python bot.py --daemon --interval-minutes 60   # hourly scans; each hour-slot sends once
```

Notes:

- The bot reads JioMart's product APIs with your pincode. It embeds no session token. If JioMart answers 401/403, copy your own `Authorization` header from your browser's DevTools Network tab into `JIOMART_BEARER` in `.env` (it expires when your browser session does).
- State lives in `bot-v2/jiomart_bot.db` (SQLite, created on first run). One shared HTTP session, one DB connection per call (always closed), a single-thread health server only when `$PORT` is set, and `gc.collect()` before exit.
- The bot only alerts new deals, price drops, restocks and discount rises; unchanged deals repeat only after 7 days.
- Multi-pincode: pass `--pincode` more than once, or set `JIOMART_PINCODES=560045,110001` in `.env`. Each pincode is scanned and diffed against its own price history, since prices differ by dark store.
- Export: `--export csv` (or `json`) writes every fetched product to `exports/jiomart-deals-<stamp>.csv|json` with pincode, price, MRP, discount, saving, stock and diff type (`new`, `price_drop`, `restocked`, `discount_up`, `weekly`, `stale`) — the same columns feed the PriceDrop-Hunter compare page.

## How it gets data

Uses JioMart's product API (the same one the site calls) with the delivery pincode JioMart saved for you, sorted by discount, 50 products per page on the Vertex endpoint (40 on the catalogue fallback). The pincode is resolved to coordinates and serving stores first, so results match your delivery address.

## Troubleshooting

- **Blank results / "No deals".** Hunter now says why: no pincode, signed out, rate-limited, an empty category, unreadable products, or everything filtered out. Follow the hint it shows — usually set your delivery pincode on jiomart.com first, or sign in again, then scan. If you are signed out, JioMart returns a login page instead of data — v2 tells you this in a toast; sign in and retry.
- **"None could be read" toast.** JioMart returned products in a format the parser does not recognise. The API shape has changed; check for a newer release.
- **Login / location errors.** The scan needs the `pin` value JioMart saves in your browser. Clear it by re-setting the pincode on the site; private/incognito windows start without one.
- **Telegram test fails.** Install the userscript — the plain bookmarklet is blocked from calling Telegram on some pages. Check the token and chat ID, and that you pressed **Start** in your bot.
- **Deals differ from a friend's.** Prices and stock depend on the dark store near your delivery address, so everyone sees their own local deals.

## Testing

```bash
node --check src/deals.js
node test-results-tab.js   # PASS: 10 of 10 valid products render as cards (12 raw, 2 correctly rejected)
node test/power-features.test.js   # PASS: 22 of 22 checks (multi-keyword search, unit prices, dedupe, diagnostics, self-test, best-value row)
node build.js              # rebuilds dist/ and index.html
```

Live platform APIs were not verified from this machine — the tests use a saved sample payload (`fixtures/sample-api.json`) and a stubbed fetcher for the bot export test. Please do one manual browser test: open jiomart.com, set your pincode, run the bookmarklet and confirm a scan returns cards; press **Self-test** and confirm 6 of 6 checks pass.

## Project layout

```
src/deals.js         the app (one file, no dependencies)
src/index.tpl.html   install page template
build.js             builds dist/ and index.html
bot-v2/              Python Telegram bot (fetcher.py, database.py, differ.py, notifier.py, bot.py)
fixtures/            sample API payload for the regression test
test-results-tab.js  regression test: fixture -> parser -> rendered cards
test/power-features.test.js   v2.1 tests: multi-keyword search, unit prices, dedupe, diagnostics, self-test, best-value row
dist/                built bookmarklet, loader, userscript
favicon.svg
```

Run `node build.js` after any change.

## License

MIT — see [LICENSE](LICENSE).

---

Made with ♥ by [Satyam Raj](https://www.linkedin.com/in/satyamraj1)
