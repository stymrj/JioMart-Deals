#!/usr/bin/env python3
"""JioMart deals fetcher (PriceDrop Hunter bot-v2).

Reads JioMart's product API the way the site itself does: resolve the
delivery location for a pincode, ask for the delivery promise (which dark
stores / polygons serve it), then page the Vertex product endpoint sorted
by discount. No browser automation, no scraping of HTML pages.

Resource discipline: one shared ``requests.Session`` for the whole run,
one SQLite connection per database call (always closed), polite delays
between pages, and an explicit ``gc.collect()`` before exit.
"""
import gc
import json
import os
import random
import re
import time
import urllib.parse

try:
    import requests
    _SESSION = requests.Session()
except ImportError:  # pragma: no cover - requests is in requirements.txt
    requests = None
    _SESSION = None

BASE = "https://www.jiomart.com"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36")
DEFAULT_PINCODE = os.environ.get("JIOMART_PINCODE", "560045")


def _headers(extra=None):
    h = {"accept": "application/json, text/plain, */*", "User-Agent": UA,
         "x-currency-code": "INR"}
    token = os.environ.get("JIOMART_BEARER", "").strip()
    if token:
        h["authorization"] = token if token.lower().startswith("bearer ") else "Bearer " + token
    if extra:
        h.update(extra)
    return h


def _get(url, headers=None, timeout=10):
    """One shared session for every request; returns (status, parsed body)."""
    if _SESSION is None:
        raise RuntimeError("requests is not installed: pip install -r requirements.txt")
    try:
        with _SESSION.get(url, headers=_headers(headers), timeout=timeout) as r:
            try:
                return r.status_code, r.json()
            except ValueError:
                return r.status_code, r.text
    except Exception as exc:  # network error, timeout, DNS
        return 0, str(exc)


def resolve_location(pincode):
    """Pincode -> lat/lon/city/state via the logistics pincode endpoint."""
    url = f"{BASE}/api/service/application/logistics/v1.0/pincode/{pincode}"
    status, body = _get(url, timeout=6)
    loc = {"pincode": pincode, "latitude": "", "longitude": "",
           "city": "", "state": "", "country": "INDIA"}
    if status == 200 and isinstance(body, dict) and body.get("data"):
        d = body["data"][0]
        coords = (d.get("lat_long") or {}).get("coordinates") or []
        if len(coords) >= 2:
            loc["longitude"], loc["latitude"] = str(coords[0]), str(coords[1])
        for parent in d.get("parents", []):
            if parent.get("sub_type") == "city":
                loc["city"] = parent.get("name", "")
            elif parent.get("sub_type") == "state":
                loc["state"] = parent.get("name", "")
            elif parent.get("sub_type") == "country":
                loc["country"] = parent.get("name", "INDIA")
    return loc


def fetch_delivery_promise(loc):
    """Delivery promise -> store_ids + polygon_ids for this location."""
    url = f"{BASE}/api/service/application/logistics/v1.0/delivery-promise"
    headers = {
        "x-geolocation": json.dumps({"latitude": loc["latitude"], "longitude": loc["longitude"]}),
        "x-location-detail": json.dumps({
            "country": loc["country"], "country_iso_code": "IN",
            "city": loc["city"], "pincode": loc["pincode"], "state": loc["state"]}),
    }
    status, body = _get(url, headers=headers, timeout=6)
    store_ids, polygon_ids = [], []
    if status == 200 and isinstance(body, dict):
        store_ids = ((body.get("query_params") or {}).get("store_ids") or [])
        for item in body.get("items", []):
            for leg in item.get("journey_wise_promise", []):
                poly = (leg.get("meta") or {}).get("polygon_id")
                if poly and poly not in polygon_ids:
                    polygon_ids.append(poly)
    return {"store_ids": store_ids, "polygon_ids": polygon_ids}


def _num(node):
    """One price-ish value as a float. Strings like "₹1,999" or "1999.50"
    parse to 1999.0 / 1999.5; anything unreadable is 0.0."""
    if node is None or isinstance(node, bool):
        return 0.0
    if isinstance(node, (int, float)):
        return float(node)
    m = re.search(r"\d+(?:\.\d+)?", str(node).replace(",", ""))
    return float(m.group(0)) if m else 0.0


def _price_of(node):
    """Price node may be {max, min}, a flat number, or a string."""
    if node is None:
        return 0.0
    if isinstance(node, dict):
        for key in ("max", "min", "value", "amount"):
            v = _num(node.get(key))
            if v:
                return v
        return 0.0
    return _num(node)


def _disc_of(node):
    """Explicit discount as percent: a number (90, 87.5) or a string
    ("90%", "87.5%"). 0 (or absent/unreadable) means no discount stated."""
    if node is None or isinstance(node, bool):
        return 0.0
    if isinstance(node, (int, float)):
        return float(node)
    m = re.search(r"\d+(?:\.\d+)?", str(node).replace(",", ""))
    return float(m.group(0)) if m else 0.0


def parse_product(raw):
    """Normalise one raw API item. Returns None when it cannot be sold/read."""
    try:
        name = raw.get("name") or ""
        price_node = raw.get("price") or {}
        sell = _price_of(price_node.get("effective")) or _price_of(price_node.get("marked")) \
            or _price_of(raw.get("selling_price")) or _price_of(raw.get("sale_price"))
        # Strikethrough (MRP) may live under price.marked, price.mrp, or a
        # top-level field on the item — read every shape before giving up.
        mrp = _price_of(price_node.get("marked")) or _price_of(price_node.get("mrp")) \
            or _price_of(raw.get("mrp")) or _price_of(raw.get("list_price")) \
            or _price_of(raw.get("strike_price")) or _price_of(raw.get("original_price")) \
            or sell
        if not name or not sell:
            return None
        if mrp < sell:
            mrp = sell
        if mrp <= sell:
            # No usable MRP, but the API states a discount: derive the MRP
            # from sell price + discount instead of reporting 0% off (which
            # the min-discount filter then hides, so the deal never appears).
            disc_raw = None
            for key in ("discount", "discount_pct", "discount_percent", "discount_percentage"):
                if raw.get(key) is not None:
                    disc_raw = raw.get(key)
                    break
            if disc_raw is None:
                for key in ("discount", "discount_pct"):
                    if price_node.get(key) is not None:
                        disc_raw = price_node.get(key)
                        break
            d = _disc_of(disc_raw)
            if 0 < d < 100:
                mrp = sell / (1 - d / 100)
        # 2026-11-09: the old guard dropped anything over 95% off (mrp >
        # sell * 20), so every genuine 96-99% clearance item vanished
        # before it could alert. Only >99% off (mrp > sell * 100) is still
        # treated as an inflated list price.
        if mrp > sell * 100:  # >99% off: almost always an inflated list price
            return None
        disc = round((mrp - sell) / mrp * 100, 1) if mrp > sell else 0.0
        brand = raw.get("brand")
        brand = brand.get("name") if isinstance(brand, dict) else (brand or raw.get("brand_name") or "")
        sellable = raw.get("sellable", True)
        in_stock = bool(sellable)
        variants = raw.get("instock_variants")
        if isinstance(variants, dict) and isinstance(variants.get("sizes"), list):
            in_stock = in_stock and len(variants["sizes"]) > 0
        medias = raw.get("medias") or []
        img = medias[0].get("url", "") if medias and isinstance(medias[0], dict) else ""
        slug = raw.get("slug") or ""
        qty = " ".join(x for x in (str(raw.get("net-quantity-value") or ""),
                                   str(raw.get("net-quantity-unit") or "")) if x).strip()
        cats = [c.get("name") for c in (raw.get("categories") or [])
                if isinstance(c, dict) and c.get("name")]
        return {
            "uid": raw.get("uid") or raw.get("item_code") or slug,
            "name": name, "brand": brand or "JioMart",
            "effective_price": float(sell), "mrp": float(mrp),
            "discount_pct": disc, "savings": round(mrp - sell, 2),
            "in_stock": in_stock, "quantity": qty,
            "categories": cats, "image": img,
            "url": f"{BASE}/product/{slug}" if slug else "",
        }
    except Exception:
        return None


class Fetcher:
    """One fetcher per run: resolves location once, reuses the session."""

    def __init__(self, pincode=None):
        self.pincode = pincode or DEFAULT_PINCODE
        self.location = resolve_location(self.pincode)
        self.delivery = fetch_delivery_promise(self.location)

    def _headers(self):
        loc = self.location
        h = {
            "x-geolocation": json.dumps({
                "latitude": loc["latitude"], "longitude": loc["longitude"],
                "polygon_ids": self.delivery.get("polygon_ids", [])}),
            "x-location-detail": json.dumps({
                "country": loc["country"], "country_iso_code": "IN",
                "city": loc["city"], "pincode": loc["pincode"], "state": loc["state"]}),
        }
        return h

    def fetch_category(self, category, limit=50, max_pages=3, min_discount=None):
        """Page one l1 category, discount-sorted, until limit / has_next ends."""
        store_ids = self.delivery.get("store_ids", [])
        parts = ["department:groceries"]
        if store_ids:
            parts.append("journey:quickcommerce")
            parts.append("store_ids:" + "||".join(store_ids[:10]))
        parts.append("l1_category:" + category)
        out, page, total = [], 1, 0
        while page <= max_pages and len(out) < limit:
            params = {"f": ":::".join(parts), "page_size": "50",
                      "sort_on": "discount_dsc", "page_no": str(page),
                      "page_type": "number"}
            url = f"{BASE}/ext/vertex/application/api/v1.0/products?{urllib.parse.urlencode(params)}"
            status, body = _get(url, headers=self._headers(), timeout=10)
            if status != 200 or not isinstance(body, dict):
                break
            pg = body.get("page") or {}
            total = pg.get("item_total", total)
            items = body.get("items") or []
            if not items:
                break
            for raw in items:
                p = parse_product(raw)
                if not p:
                    continue
                if min_discount is not None and p["discount_pct"] < min_discount:
                    continue
                out.append(p)
                if len(out) >= limit:
                    break
            # Paging: has_next/next_id when the API sends them; a full page
            # with neither flag still implies more (mirrors the browser
            # tool, which treats a full page as "more" instead of stopping
            # the scan after page 1 when the flag is absent).
            has_next = pg.get("has_next")
            if has_next is None:
                has_next = bool(pg.get("next_id")) or len(items) >= 50
            if not has_next:
                break
            page += 1
            time.sleep(random.uniform(0.5, 1.1))  # polite gap between pages
        return {"total_available": total, "products": out}

    def close(self):
        gc.collect()


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="Fetch JioMart deals for one category")
    ap.add_argument("--pincode", default=None)
    ap.add_argument("--category", default="cooking-essentials")
    ap.add_argument("--limit", type=int, default=20)
    ap.add_argument("--min-discount", type=float, default=30)
    args = ap.parse_args()
    f = Fetcher(args.pincode)
    res = f.fetch_category(args.category, limit=args.limit, min_discount=args.min_discount)
    for p in res["products"]:
        print(f"{p['discount_pct']:>5}% off  ₹{p['effective_price']:<8} (MRP ₹{p['mrp']})  {p['name'][:60]}")
    print(f"{len(res['products'])} deals (catalogue: {res['total_available']})")
    f.close()
