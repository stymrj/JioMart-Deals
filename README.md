# PriceDrop Hunter for JioMart

Scans the JioMart categories you pick, sorted by discount, and shows the biggest deals. It runs in your own browser as a bookmarklet or userscript. Nothing is uploaded and there is no account.

**Live page:** https://stymrj.github.io/JioMart-Deals/

## Features

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

## Install

![Install walkthrough](https://stymrj.github.io/PriceDrop-Hunter/media/install-demo.gif)

[Watch the walkthrough video (MP4)](https://stymrj.github.io/PriceDrop-Hunter/media/install-demo.mp4)

**Bookmarklet (desktop).** Run `node build.js`, open `index.html`, and drag the button to your bookmarks bar. Open jiomart.com and click the bookmark.

**Bookmarklet (mobile).** On the install page, tap **Copy mobile loader**. It is a bookmark of about 380 characters that loads the latest version from GitHub Pages, so it fits on any phone. Create a bookmark, paste it as the address, and run it from the address bar on jiomart.com. The full bookmarklet (about 45 KB, no network needed) is in `dist/bookmarklet.txt`.

**Userscript.** Install `dist/jiomart-deals.user.js` in Tampermonkey or Violentmonkey. A small Deals button appears on every jiomart.com page.

## Keyboard shortcuts

`/` search, `S` scan or stop, `Esc` close.

## Telegram alerts

Hunter can send new deals, price drops and cheaper saved items to your Telegram.

1. In Telegram, open `@BotFather`, send `/newbot`, and copy the bot token.
2. Open your new bot and press **Start**.
3. Get your chat ID from `@userinfobot`, or open `https://api.telegram.org/bot<token>/getUpdates` and copy `chat.id`.
4. On the store, open Hunter, press **Telegram** in the top bar, paste the token and chat ID, press **Send test**, then switch alerts on.

Each deal is sent once, and again only if its price drops further. Use the userscript for alerts: some shops block bookmarklets from calling Telegram, while the userscript sends through `GM_xmlhttpRequest`. The token is stored only in your browser.

## How it gets data

Uses JioMart's product API (the same one the site calls) with the delivery pincode JioMart saved for you, sorted by discount, 40 products per page.

## Limitations

- Set your JioMart pincode first.
- Items listed at more than 95% off are hidden: on JioMart these are almost always inflated list prices.
- The API is undocumented and can change.

## Project layout

```
src/deals.js         the app (one file, no dependencies)
src/index.tpl.html   install page template
build.js             builds dist/ and index.html
favicon.svg
```

Run `node build.js` after any change.

---

Made with ♥ by [Satyam Raj](https://www.linkedin.com/in/satyamraj1)
