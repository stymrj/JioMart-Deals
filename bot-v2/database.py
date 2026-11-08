"""SQLite storage for the JioMart bot (bot-v2).

Every connection is opened inside the ``get_db_connection`` context
manager and closed on exit — a connection is never left open across a
run, which is what leaked memory in earlier bot code. Tables: users
(one row per Telegram user), product_history (last seen price /
last alert per product + pincode), alert_logs, scheduler_history
(one row per broadcast slot, so a slot never sends twice).
"""
import os
import sqlite3
from contextlib import contextmanager

DB_PATH = os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "jiomart_bot.db"))


@contextmanager
def get_db_connection():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=20.0)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        try:
            conn.close()
        except Exception:
            pass


def init_db():
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("""CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY, username TEXT, first_name TEXT,
            pincode TEXT, min_discount REAL DEFAULT 60.0,
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_active_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)""")
        cur.execute("""CREATE TABLE IF NOT EXISTS product_history (
            product_uid TEXT, pincode TEXT, name TEXT, brand TEXT,
            effective_price REAL, mrp REAL, discount_pct REAL,
            in_stock INTEGER, url TEXT,
            last_alert_date TEXT, last_alert_price REAL,
            first_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (product_uid, pincode))""")
        cur.execute("""CREATE TABLE IF NOT EXISTS alert_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
            product_uid TEXT, alert_type TEXT, sent_price REAL,
            sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)""")
        cur.execute("""CREATE TABLE IF NOT EXISTS scheduler_history (
            slot_key TEXT PRIMARY KEY, executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            deals_sent INTEGER DEFAULT 0, info TEXT)""")
        conn.commit()


def save_or_update_user(user_id, username="", first_name="", pincode="", min_discount=60.0):
    with get_db_connection() as conn:
        conn.execute(
            """INSERT INTO users (user_id, username, first_name, pincode, min_discount)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(user_id) DO UPDATE SET
                 username=excluded.username, first_name=excluded.first_name,
                 pincode=excluded.pincode, min_discount=excluded.min_discount,
                 last_active_at=CURRENT_TIMESTAMP""",
            (user_id, username, first_name, pincode, min_discount))
        conn.commit()


def get_all_active_users():
    with get_db_connection() as conn:
        rows = conn.execute("SELECT * FROM users WHERE is_active = 1").fetchall()
        return [dict(r) for r in rows]


def get_product_history(uid, pincode):
    with get_db_connection() as conn:
        row = conn.execute(
            "SELECT * FROM product_history WHERE product_uid = ? AND pincode = ?",
            (uid, pincode)).fetchone()
        return dict(row) if row else None


def upsert_product_history(product, pincode, last_alert_date=None, last_alert_price=None):
    with get_db_connection() as conn:
        conn.execute(
            """INSERT INTO product_history
               (product_uid, pincode, name, brand, effective_price, mrp,
                discount_pct, in_stock, url, last_alert_date, last_alert_price)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(product_uid, pincode) DO UPDATE SET
                 name=excluded.name, brand=excluded.brand,
                 effective_price=excluded.effective_price, mrp=excluded.mrp,
                 discount_pct=excluded.discount_pct, in_stock=excluded.in_stock,
                 url=excluded.url, last_seen_at=CURRENT_TIMESTAMP,
                 last_alert_date=COALESCE(excluded.last_alert_date, product_history.last_alert_date),
                 last_alert_price=COALESCE(excluded.last_alert_price, product_history.last_alert_price)""",
            (product.get("uid"), pincode, product.get("name"), product.get("brand"),
             product.get("effective_price"), product.get("mrp"),
             product.get("discount_pct"), 1 if product.get("in_stock") else 0,
             product.get("url"), last_alert_date, last_alert_price))
        conn.commit()


def log_alert(user_id, uid, alert_type, sent_price):
    with get_db_connection() as conn:
        conn.execute("INSERT INTO alert_logs (user_id, product_uid, alert_type, sent_price) VALUES (?, ?, ?, ?)",
                     (user_id, uid, alert_type, sent_price))
        conn.commit()


def is_slot_executed(slot_key):
    with get_db_connection() as conn:
        return conn.execute("SELECT 1 FROM scheduler_history WHERE slot_key = ?",
                            (slot_key,)).fetchone() is not None


def record_slot_execution(slot_key, deals_sent=0, info=""):
    with get_db_connection() as conn:
        conn.execute("INSERT OR REPLACE INTO scheduler_history (slot_key, deals_sent, info) VALUES (?, ?, ?)",
                     (slot_key, deals_sent, info))
        conn.commit()
