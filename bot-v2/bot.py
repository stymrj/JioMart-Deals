#!/usr/bin/env python3
"""PriceDrop Hunter · JioMart bot (bot-v2) — entry point.

Scans the configured JioMart categories, diffs them against SQLite
history, and sends only new / dropped / restocked / improved deals to
Telegram. Run once, or with --daemon for an hourly scan loop. Scans one
or more pincodes (prices differ by dark store) and can export every
fetched product to CSV/JSON.

    python bot.py --once --pincode 110001 --min-discount 50
    python bot.py --once --pincode 560045 --pincode 110001 --export csv
    python bot.py --daemon --interval-minutes 60

Resource discipline: a single shared requests session (see fetcher),
database connections that always close (see database), a single-thread
HTTP health server (only when $PORT is set, for hosted runs), and
gc.collect() before exit.
"""
import argparse
import csv
import gc
import json
import os
import sys
import threading
import time
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fetcher import Fetcher
from differ import analyze_deals
from notifier import format_deals, send_message
from database import init_db, is_slot_executed, record_slot_execution

CATEGORIES = [
    "cooking-essentials", "fresh-l1", "biscuits-drinks-packaged-foods",
    "personal-care", "beauty", "mom-baby-care", "home", "kitchenware-l1",
    "mobiles-tablets", "kitchen-appliances", "home-appliances",
]

DEFAULT_MIN_DISCOUNT = float(os.environ.get("MIN_DISCOUNT", "50"))
DEFAULT_LIMIT = int(os.environ.get("DEAL_LIMIT", "20"))


def load_env(path=".env"):
    if not os.path.exists(path):
        return
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def ist_now():
    return datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)


def write_export(products, fmt, outdir):
    """Write every fetched product (all pincodes) to CSV or JSON for
    spreadsheet / cross-store comparison. Returns the file path."""
    os.makedirs(outdir, exist_ok=True)
    stamp = ist_now().strftime("%Y%m%d-%H%M")
    path = os.path.join(outdir, f"jiomart-deals-{stamp}.{fmt}")
    fields = ["pincode", "uid", "name", "brand", "effective_price", "mrp",
              "discount_pct", "savings", "in_stock", "diff_type", "url"]
    rows = [{f: p.get(f, "") for f in fields} for p in products]
    if fmt == "csv":
        with open(path, "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=fields)
            w.writeheader()
            w.writerows(rows)
    else:
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(rows, fh, indent=2, ensure_ascii=False)
    print(f"Exported {len(rows)} products to {path}")
    return path


def scan_once(pincodes, min_discount, limit, dry_run=False, categories=None,
              max_pages=3, export_fmt=None, export_dir="exports"):
    """One full scan across one or more pincodes. Prices differ by dark
    store, so each pincode is scanned and diffed on its own history;
    products are tagged with their pincode. Returns deals sent (0 dry-run)."""
    init_db()
    all_products, total_sent = [], 0
    for pin in pincodes:
        fetcher = Fetcher(pin)
        pin_products, seen = [], set()
        for cat in (categories or CATEGORIES):
            try:
                res = fetcher.fetch_category(cat, limit=limit, min_discount=min_discount,
                                             max_pages=max_pages)
            except Exception as exc:
                print(f"[{pin}][{cat}] fetch failed: {exc}")
                continue
            for p in res["products"]:
                if p["uid"] not in seen:
                    seen.add(p["uid"])
                    pin_products.append(dict(p, pincode=pin))
            print(f"[{pin}][{cat}] {len(res['products'])} deals")
            time.sleep(1)
        fetcher.close()
        alertable, stale = analyze_deals(pin_products, pin)
        alertable.sort(key=lambda p: (-p["discount_pct"], -p["savings"]))
        print(f"[{pin}] {len(alertable)} alertable deals out of {len(pin_products)} fetched")
        diff_of = {p["uid"]: p.get("diff_type", "") for p in alertable + stale}
        for p in pin_products:
            p["diff_type"] = diff_of.get(p["uid"], "")
        all_products.extend(pin_products)
        if not alertable:
            continue
        text = format_deals(alertable, pincode=pin)
        if dry_run:
            print(f"--- DRY RUN [{pin}] (not sent) ---")
            print(text)
            continue
        try:
            send_message(text)
            print(f"[{pin}] Sent {min(len(alertable), 12)} deals to Telegram")
            total_sent += len(alertable)
        except Exception as exc:
            print(f"[{pin}] Telegram send failed: {exc}")
    if export_fmt:
        write_export(all_products, export_fmt, export_dir)
    print(f"{total_sent} alertable deals sent across {len(pincodes)} pincode(s), "
          f"{len(all_products)} products fetched in total")
    return total_sent


def start_health_server():
    """Single-thread HTTP server, only when $PORT is set (hosted runs)."""
    port = os.environ.get("PORT")
    if not port:
        return
    from http.server import HTTPServer, BaseHTTPRequestHandler

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            body = b"OK" if self.path != "/" else b"PriceDrop Hunter JioMart bot is running."
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.end_headers()
            try:
                self.wfile.write(body)
            except Exception:
                pass

        def log_message(self, *args):
            pass

    # HTTPServer is single-threaded by design: one request at a time,
    # no thread pool growing over the life of the process.
    server = HTTPServer(("0.0.0.0", int(port)), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    print(f"Health server listening on port {port}")


def main():
    ap = argparse.ArgumentParser(description="JioMart Telegram deals bot (v2)")
    ap.add_argument("--pincode", action="append", default=None,
                    help="delivery pincode to scan (repeatable; default: JIOMART_PINCODE or JIOMART_PINCODES)")
    ap.add_argument("--min-discount", type=float, default=DEFAULT_MIN_DISCOUNT)
    ap.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help="max deals per category")
    ap.add_argument("--max-pages", type=int, default=3, help="max API pages per category")
    ap.add_argument("--category", action="append", default=None, help="scan only this l1 category (repeatable)")
    ap.add_argument("--export", choices=["csv", "json"], default=None,
                    help="also write every fetched product to exports/jiomart-deals-<stamp>.csv|json")
    ap.add_argument("--export-dir", default="exports")
    ap.add_argument("--once", action="store_true", help="scan once and exit (default)")
    ap.add_argument("--daemon", action="store_true", help="scan every --interval-minutes")
    ap.add_argument("--interval-minutes", type=int, default=60)
    ap.add_argument("--dry-run", action="store_true", help="fetch and diff, do not send Telegram")
    args = ap.parse_args()

    load_env(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
    load_env(".env")
    start_health_server()

    # Pincodes: --pincode flags win, else JIOMART_PINCODES (comma-separated),
    # else the single JIOMART_PINCODE (default 560045).
    pincodes = args.pincode
    if not pincodes:
        multi = os.environ.get("JIOMART_PINCODES", "").strip()
        pincodes = [p.strip() for p in multi.split(",") if p.strip()] or None
    if not pincodes:
        pincodes = [os.environ.get("JIOMART_PINCODE", "560045")]

    if args.daemon:
        print(f"Bot running every {args.interval_minutes} min (PINs {', '.join(pincodes)}, min {args.min_discount}% off)")
        while True:
            slot = ist_now().strftime("%Y-%m-%d-%H")
            if not is_slot_executed(slot):
                n = scan_once(pincodes, args.min_discount, args.limit,
                              dry_run=args.dry_run, categories=args.category,
                              max_pages=args.max_pages, export_fmt=args.export,
                              export_dir=args.export_dir)
                record_slot_execution(slot, deals_sent=n)
            time.sleep(args.interval_minutes * 60)
    else:
        scan_once(pincodes, args.min_discount, args.limit,
                  dry_run=args.dry_run, categories=args.category,
                  max_pages=args.max_pages, export_fmt=args.export,
                  export_dir=args.export_dir)
    gc.collect()


if __name__ == "__main__":
    main()
