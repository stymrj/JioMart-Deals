# Changelog

## v2.1.0 — 2026-11-08
- Fixed (2026-11-09): GitHub Actions workflow created (`.github/workflows/telegram-bot.yml`, none existed) — hourly scans 08:45–23:45 IST, `BOT_ENABLED` gate, `bot-v2/jiomart_bot.db` cached between runs so dedupe and the 7-day cooldown survive, `workflow_dispatch` dry run. Secrets are `${{ secrets.* }}` only; vars `JIOMART_PINCODE` (default 560045), `JIOMART_PINCODES`, `MIN_DISCOUNT` (50), `DEAL_LIMIT` (20).
- Fixed (2026-11-09): `bot.py --once` now exits non-zero when the scan fetched nothing at all or a Telegram send failed (previously both were caught, logged, and exited 0, so a broken run looked green). A quiet run (fetched, nothing alertable) still exits 0; `--daemon` behaviour unchanged. Also, an empty `JIOMART_PINCODE`/`MIN_DISCOUNT`/`DEAL_LIMIT` now falls back to the default instead of scanning pincode `""` or crashing.
- Fixed (2026-11-09): install-page and README wording — the desktop install step named the drag button “PriceDrop Hunter” (it reads “JioMart Deals”); the mobile step named the bookmark `PriceDrop` (README says “JioMart Deals”); the “0 bytes uploaded” stat ignored Telegram alerts; the features grid omitted Self-test/diagnostics, Deep scan, the best-value-per-kg row and the in-stock-only default, all of which exist in the tool; README said “Grid and list views” (there is no list-view control — grid only) and “Saved items strip showing how much each one dropped since you saved it” (the saved price is never displayed — the Saved tab shows price-drop labels and sparklines); the full bookmarklet is about 66 KB, not 45 KB; the jsDelivr loader (`…@v2/dist/deals.js`) was removed — jsDelivr reads `@v2` as a version range and answers 404 (verified: `@v2` 404, full commit hash 200).
- Fixed (2026-11-09): install button now reads “JioMart Deals” instead of the generic “PriceDrop Hunter”, so the dragged bookmark is named after this store instead of colliding with every other tool.
- Fixed (2026-11-09): highest-discount products now fetch — the inflated-MRP guard dropped every genuine 96–99% off item (`mrp > sell * 20`), and items with no marked price parsed at 0% off and vanished under the minimum-discount filter. The guard now only rejects >99% off; an explicit discount field (or an MRP under a different field name) supplies the discount when no marked price is carried. Same fix mirrored in `bot-v2/fetcher.py`, which additionally now parses string MRPs like “₹1,999” and keeps paging when a full page arrives without a `has_next` flag. Tests: `node test-results-tab.js` — PASS, 10 of 10 original fixture cards plus highest-discount PASS (15 of 16 parse, 99% renders first); `node test/power-features.test.js` — PASS, 27 of 27 checks (self-test grew 6 → 8 cases).

Better than the baseline, not just a port of it:

- **Empty-state diagnostics.** A scan that finds nothing now names the cause — no pincode, signed out (login page), 401/403 session expiry, HTTP 429 rate-limit, 5xx server error, empty category, unreadable payload, or everything filtered out by the minimum discount — shown as a diagnosis card with what to do, and in the toast.
- **Built-in self-test.** A **Self-test** button in the menu runs the real parser on bundled samples (max-only / min-only / flat prices, inflated-MRP and no-price rejects, 96%-off clearance, no-MRP + explicit-discount, unit-price parsing) with no network. Same 8 cases are covered by `test/power-features.test.js`.
- **Retry with exponential backoff.** Page fetches retry up to 4 times on 429/5xx (0.7s, 1.4s, 2.8s, 5.6s + jitter) instead of failing the scan.
- **Deeper scans.** Default depth 3 pages per category (was 2), up to 6, plus a one-tap **Deep scan** (all 20 categories, 5 pages each, parallel workers) with a live per-page progress readout (`Scanning 7/20 · 34/100 pages`). Results are de-duplicated across pages and categories, keeping the best discount per product.
- **Cross-category best-value row.** A "Best value per kg / litre" row ranks the cheapest unit price across every category scanned, beside the biggest-%-off grid.
- **Multi-keyword search.** Commas split OR groups (`atta, rice` matches either); words without a comma must all match; brand names are searchable.
- **Bot: multi-pincode + exports.** `bot.py` accepts repeatable `--pincode` (or `JIOMART_PINCODES`), diffing each pincode against its own price history, and `--export csv|json` writes every fetched product to `exports/` with pincode and diff type. `--max-pages` now controls pages per category.
- Tests: `node test/power-features.test.js` — PASS, 27 of 27 checks (was 22; +5 highest-discount checks, self-test 6 → 8 cases).

## v2.0.0 — 2026-11-08

- Fetch layer rewritten for the current JioMart API shape: Vertex product endpoint (`/ext/vertex/application/api/v1.0/products`, discount-sorted, 50/page) with store/polygon routing resolved once per scan from the delivery pincode; catalogue endpoint kept as fallback. No token embedded — runs in the user's own session.
- Blank-results bug fixed: prices read max-first (`.max`, then `.min`, then flat numbers) so Vertex payloads no longer parse as ₹0 and vanish. Regression test added (`node test-results-tab.js`): PASS — 10 of 10 valid fixture products render as cards (12 raw, 2 correctly rejected).
- Stock check corrected: sellable plus in-stock variant sizes when reported; sellable alone when variant data is absent.
- Clearer empty states: login-page-instead-of-data and unparseable-payload cases now surface a toast explaining what happened.
- New Python Telegram bot in `bot-v2/` (fetcher + SQLite history + differ + notifier + CLI/daemon entry point). 7-day cooldown for unchanged deals; single shared HTTP session, connections always closed, single-thread health server, `gc.collect()` on exit.
- README rewritten for v2 (install, use, bot setup, troubleshooting, testing). Install video links point at the PriceDrop-Hunter media files.

## v1.0.0 — 2026-10-25

- Initial PriceDrop Hunter release for JioMart: category scans sorted by discount, price history, saved items, unit prices, presets, CSV export, Telegram alerts from the browser, bookmarklet + userscript + install page.
