"""Deal differ for the JioMart bot (bot-v2).

Compares the current fetch against product_history and sorts products
into: new deals, price drops, restocks, discount increases, and stale
items. An unchanged item is only re-alerted after a 7-day cooldown, so
subscribers are not spammed with the same deal every run.
"""
import datetime

from database import get_product_history, upsert_product_history

COOLDOWN_DAYS = 7


def _today_ist():
    utc = datetime.datetime.now(datetime.timezone.utc)
    return (utc + datetime.timedelta(hours=5, minutes=30)).strftime("%Y-%m-%d")


def analyze_deals(products, pincode):
    """Returns (alertable, stale). Each alertable item carries diff_type/tag/reason."""
    today = _today_ist()
    today_dt = datetime.datetime.strptime(today, "%Y-%m-%d").date()
    alertable, stale = [], []
    for p in products:
        uid = p.get("uid") or p.get("url") or p.get("name")
        price = float(p.get("effective_price") or 0)
        disc = float(p.get("discount_pct") or 0)
        in_stock = bool(p.get("in_stock", True))
        history = get_product_history(uid, pincode)
        if not history:
            item = dict(p, diff_type="new", diff_tag="NEW DEAL",
                        diff_reason="First time seen at a high discount")
            alertable.append(item)
            upsert_product_history(p, pincode, last_alert_date=today, last_alert_price=price)
            continue
        prev_price = float(history.get("effective_price") or price)
        prev_disc = float(history.get("discount_pct") or disc)
        prev_stock = bool(history.get("in_stock", True))
        last_price = float(history.get("last_alert_price") or prev_price)
        last_date = history.get("last_alert_date")
        days = 999
        if last_date:
            try:
                days = (today_dt - datetime.datetime.strptime(last_date, "%Y-%m-%d").date()).days
            except ValueError:
                pass
        dropped = price < min(prev_price, last_price) - 1.0
        restocked = (not prev_stock) and in_stock
        disc_up = disc >= prev_disc + 2.0
        if dropped:
            item = dict(p, diff_type="price_drop", diff_tag=f"PRICE DROP (-₹{min(prev_price, last_price) - price:,.0f})",
                        diff_reason=f"Dropped from ₹{last_price:,.0f} to ₹{price:,.0f}")
        elif restocked:
            item = dict(p, diff_type="restocked", diff_tag="BACK IN STOCK",
                        diff_reason="Previously out of stock")
        elif disc_up:
            item = dict(p, diff_type="discount_up", diff_tag=f"DISCOUNT UP (+{disc - prev_disc:.0f}%)",
                        diff_reason=f"Discount rose from {prev_disc:.0f}% to {disc:.0f}%")
        elif days >= COOLDOWN_DAYS:
            item = dict(p, diff_type="weekly", diff_tag="WEEKLY TOP PICK",
                        diff_reason="7-day refresh for an active high-discount item")
        else:
            stale.append(dict(p, diff_type="stale"))
            upsert_product_history(p, pincode)
            continue
        alertable.append(item)
        upsert_product_history(p, pincode, last_alert_date=today, last_alert_price=price)
    return alertable, stale
