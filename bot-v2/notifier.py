"""Telegram notifier for the JioMart bot (bot-v2).

Sends deal messages through the Telegram Bot API with one shared
``requests.Session``. Messages are HTML-escaped and sent one chat at a
time; a failure for one chat never stops the rest.
"""
import html
import os

try:
    import requests
    _SESSION = requests.Session()
except ImportError:
    requests = None
    _SESSION = None


def _creds(token=None, chat_id=None):
    token = (token or os.environ.get("TELEGRAM_BOT_TOKEN", "")).strip()
    chat_id = (chat_id or os.environ.get("TELEGRAM_CHAT_ID", "")).strip()
    return token, chat_id


def send_message(text, token=None, chat_id=None):
    token, chat_id = _creds(token, chat_id)
    if not token or not chat_id:
        raise RuntimeError("TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID are not set")
    if _SESSION is None:
        raise RuntimeError("requests is not installed: pip install -r requirements.txt")
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    with _SESSION.post(url, data={"chat_id": chat_id, "text": text,
                                  "parse_mode": "HTML",
                                  "disable_web_page_preview": "true"},
                       timeout=15) as resp:
        body = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
        if resp.status_code != 200 or not body.get("ok", resp.status_code == 200):
            raise RuntimeError(body.get("description") or f"Telegram HTTP {resp.status_code}")
    return True


def format_deals(deals, pincode=""):
    lines = ["<b>PriceDrop Hunter · JioMart</b>",
             f"{len(deals)} new deal{'s' if len(deals) != 1 else ''}" +
             (f" · PIN {html.escape(str(pincode))}" if pincode else ""), ""]
    for p in deals[:12]:
        tag = html.escape(p.get("diff_tag") or f"{p['discount_pct']:.0f}% OFF")
        title = html.escape(str(p.get("name", ""))[:90])
        price = f"₹{p['effective_price']:,.0f}"
        mrp = f"₹{p['mrp']:,.0f}"
        reason = html.escape(p.get("diff_reason") or "")
        line = f"<b>{tag}</b> · {title}\n{price} <s>{mrp}</s>"
        if reason:
            line += f" · {reason}"
        if p.get("url"):
            line += f"\n<a href=\"{html.escape(p['url'])}\">Open on JioMart</a>"
        lines.append(line)
        lines.append("")
    return "\n".join(lines).strip()
