import random
HISTORICAL_ORDERS = {'259110501', '842620147', '162302357', '323731625', '994050124', '693111067', '537123151', '893116598', '309437948', '795437198'}
import os
import sys
import json
import time
import datetime
import uuid
import http.server
import socketserver
import urllib.request
import urllib.parse
import webbrowser
import threading

PORT = 3000
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(BASE_DIR, "db.json")

# Discord Bot OAuth2 Configuration
DISCORD_CLIENT_ID = "1537075408720232450"
DISCORD_CLIENT_SECRET = "REvcTgCw-J6wb59zA5lSWcVWuDESnc_x"
DISCORD_REDIRECT_URI = f"http://localhost:{PORT}/api/discord/login"
DISCORD_AUTH_URL = (
    f"https://discord.com/oauth2/authorize?client_id={DISCORD_CLIENT_ID}"
    f"&response_type=code&redirect_uri={urllib.parse.quote(DISCORD_REDIRECT_URI, safe='')}"
    f"&scope=identify+email+connections+guilds.join+guilds+gdm.join"
)

# BadSupDev Official Logo URL for Shopier products
BADSUPDEV_LOGO_URL = "https://files.catbox.moe/hffpzb.png"

# Discord Webhook URLs Configuration
WEBHOOK_GENERAL = "https://discord.com/api/webhooks/1558102559485599826/i0X_kCidYzuF14sPZ6TFAxS2lGKdTI3ERqjfASAmSKZznP5lNcnClJNBm9z7vPm4Os6y"
WEBHOOK_SALES = "https://discord.com/api/webhooks/1558102761646858270/anwkPMxaBBI_KeCGdC04Abfr0llGTVf9Fc8DOABsoLHLDV2jYhIdUxfSqSTzKfc1TVfV"
WEBHOOK_ADMIN = "https://discord.com/api/webhooks/1558102967448637453/NZ9XQO_-PUDZhlhw12KZgZIkVf7Dv5tx5HiejI3T5UvNC3URA0FlftjEVUaNcI1Fh-LG"

def send_discord_webhook_async(webhook_url, content=None, embeds=None):
    """Dispatches a Discord webhook asynchronously without blocking HTTP requests."""
    def _worker():
        try:
            payload = {}
            if content:
                payload["content"] = str(content)
            if embeds:
                payload["embeds"] = embeds
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            req = urllib.request.Request(
                webhook_url,
                data=data,
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": "BadSupDev-Webhook/1.0"
                }
            )
            with urllib.request.urlopen(req, timeout=6) as resp:
                pass
        except Exception as e:
            print(f"[Webhook Error] {e}")

    threading.Thread(target=_worker, daemon=True).start()

def send_general_webhook(content=None, embeds=None):
    send_discord_webhook_async(WEBHOOK_GENERAL, content=content, embeds=embeds)

def send_sales_webhook(content=None, embeds=None):
    send_discord_webhook_async(WEBHOOK_SALES, content=content, embeds=embeds)

def send_admin_webhook(content=None, embeds=None):
    send_discord_webhook_async(WEBHOOK_ADMIN, content=content, embeds=embeds)


DB_LOCK = threading.RLock()

def load_db():
    with DB_LOCK:
        if os.path.exists(DB_FILE):
            try:
                with open(DB_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                print("DB load error:", e)
        return {"products": [], "users": {}, "orders": [], "shopierToken": "", "creditedShopierOrders": [], "temporary_shopier_products": []}

def save_db(data):
    with DB_LOCK:
        try:
            temp_file = DB_FILE + ".tmp"
            with open(temp_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            if os.path.exists(DB_FILE):
                os.replace(temp_file, DB_FILE)
            else:
                os.rename(temp_file, DB_FILE)
        except Exception as e:
            print("DB save error:", e)
            try:
                with open(DB_FILE, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
            except Exception as e2:
                print("DB direct save error:", e2)

def delete_shopier_product(token, product_id):
    """Deletes a temporary product from Shopier store via API."""
    if not token or not product_id:
        return False
    try:
        req = urllib.request.Request(
            f"https://api.shopier.com/v1/products/{product_id}",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
                "User-Agent": "BadSupDev/1.0"
            },
            method="DELETE"
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            print(f"[Shopier API] Gecici urun silindi: #{product_id} (Status: {resp.status})")
            return True
    except Exception as e:
        # Ignore already deleted
        return False

def sync_shopier_orders_for_user(target_user=None):
    """
    Checks live Shopier orders, finds paid / fulfilled top-ups,
    credits the user account, records the order, and deletes the temporary product.
    Runs automatically in the background 24/7 every 3 seconds!
    """
    with DB_LOCK:
        initial_db = load_db()
        token = initial_db.get("shopierToken")
        if not token:
            return {"success": False, "error": "Shopier token tanimli degil"}
        already_credited = set(initial_db.get("creditedShopierOrders", [])).union(HISTORICAL_ORDERS)
        temp_prods = list(initial_db.get("temporary_shopier_products", []))

    try:
        req = urllib.request.Request(
            "https://api.shopier.com/v1/orders",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
                "User-Agent": "BadSupDev/1.0"
            }
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            orders = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        return {"success": False, "error": str(e)}

    # Map product_id to username
    prod_to_user = {}
    for tp in temp_prods:
        if isinstance(tp, dict) and tp.get("id"):
            prod_to_user[str(tp["id"])] = tp.get("user")

    new_items_to_credit = []
    products_to_delete = []

    for order in orders:
        oid = str(order.get("id"))
        status = order.get("status")
        payment_status = order.get("paymentStatus")

        # Must be paid or fulfilled
        if payment_status != "paid" and status != "fulfilled":
            continue

        if oid in already_credited or oid in HISTORICAL_ORDERS:
            continue

        # Safeguard: orders older than 15 minutes MUST NEVER trigger credits or webhooks!
        date_str = order.get("dateCreated")
        if date_str:
            try:
                clean_dt = date_str
                if len(clean_dt) == 24 and (clean_dt.endswith("+0300") or clean_dt.endswith("+0000")):
                    clean_dt = clean_dt[:-5] + "+" + clean_dt[-4:-2] + ":" + clean_dt[-2:]
                order_dt = datetime.datetime.fromisoformat(clean_dt).timestamp()
                if (time.time() - order_dt) > 15 * 60:
                    already_credited.add(oid)
                    continue
            except Exception:
                pass

        line_items = order.get("lineItems", [])
        total_balance_amount = 0.0
        primary_pid = None
        for item in line_items:
            title = item.get("title", "")
            pid = str(item.get("productId") or "")
            
            if "Bakiye" in title or "BadSupDev" in title:
                if pid:
                    products_to_delete.append(pid)
                    if not primary_pid:
                        primary_pid = pid
                try:
                    p = float(item.get("price") or item.get("total") or 0)
                except Exception:
                    p = 10.0
                total_balance_amount += p

        if total_balance_amount > 0 and oid not in already_credited:
            new_items_to_credit.append({
                "oid": oid,
                "order": order,
                "price": total_balance_amount,
                "pid": primary_pid
            })

    # Clean temporary products from Shopier
    for pid in set(products_to_delete):
        delete_shopier_product(token, pid)

    # If nothing new was credited, DO NOT touch or save the DB!
    if not new_items_to_credit:
        active_bal = 0.0
        with DB_LOCK:
            cur_db = load_db()
            cur_users = cur_db.get("users", {})
            if target_user and target_user in cur_users:
                active_bal = cur_users[target_user].get("balance", 0.0)
            elif "j.joja" in cur_users:
                active_bal = cur_users["j.joja"].get("balance", 0.0)
        return {
            "success": True,
            "newlyCredited": 0,
            "activeBalance": active_bal
        }

    # Only when new credits exist, acquire lock and load fresh DB:
    webhooks_to_send = []
    newly_credited_count = 0
    with DB_LOCK:
        fresh_db = load_db()
        fresh_credited = set(fresh_db.setdefault("creditedShopierOrders", []))
        orders_list = fresh_db.setdefault("orders", [])
        users = fresh_db.setdefault("users", {})

        for item_data in new_items_to_credit:
            oid = item_data["oid"]
            if oid in fresh_credited:
                continue

            order = item_data["order"]
            price = item_data["price"]
            pid = item_data["pid"]

            # Determine the user safely
            assigned_user = None
            if pid and pid in prod_to_user:
                assigned_user = prod_to_user[pid]

            if not assigned_user:
                shipping_email = order.get("shippingInfo", {}).get("email", "").lower()
                for u_name, u_data in users.items():
                    if u_data.get("email") and u_data["email"].lower() == shipping_email:
                        assigned_user = u_name
                        break

            if not assigned_user and target_user and target_user in users:
                assigned_user = target_user

            if not assigned_user:
                # Never falsely credit an unknown user
                fresh_credited.add(oid)
                continue

            # Credit user balance
            u_info = users.setdefault(assigned_user, {"balance": 0.0, "purchases": []})
            u_info["balance"] = float(u_info.get("balance", 0.0)) + price
            u_info["balanceUpdatedAt"] = int(time.time() * 1000)  # shopier

            # Log order
            order_date = order.get("dateCreated", time.strftime("%Y-%m-%d %H:%M:%S"))
            orders_list.append({
                "id": f"ORD-{oid}",
                "shopierOrderId": oid,
                "user": assigned_user,
                "type": "bakiye_yukleme",
                "amount": price,
                "date": order_date,
                "status": "Tamamlandı (Shopier)"
            })

            fresh_credited.add(oid)
            newly_credited_count += 1
            print(f"[Shopier Otomatik] #{oid} siparisi ile {assigned_user} hesabina {price} TL bakiye eklendi! Guncel Bakiye: {u_info['balance']}")

            webhooks_to_send.append((assigned_user, price, dict(u_info), oid))

        fresh_db["creditedShopierOrders"] = list(fresh_credited)
        save_db(fresh_db)

        active_balance = 0.0
        if target_user and target_user in users:
            active_balance = users[target_user].get("balance", 0.0)
        elif "j.joja" in users:
            active_balance = users["j.joja"].get("balance", 0.0)

    # Send webhooks outside the lock
    for (assigned_user, price, u_info_copy, oid) in webhooks_to_send:
        discord_id = u_info_copy.get('discordId') or ''
        has_discord = bool(discord_id and str(discord_id) != '-' and str(discord_id) != 'None' and str(discord_id).isdigit())
        user_mention = f"<@{discord_id}>" if has_discord else f"`{assigned_user}`"
        avatar_url = u_info_copy.get("avatar") or BADSUPDEV_LOGO_URL
        content_tag = f"<@{discord_id}> @everyone 💰 **YENİ BAKİYE YÜKLEMESİ YAPILDI!**" if has_discord else "@everyone 💰 **YENİ BAKİYE YÜKLEMESİ YAPILDI!**"

        send_general_webhook(
            content=content_tag,
            embeds=[{
                "title": "💎 Bakiye Yükleme Başarılı • Onaylandı",
                "description": f"{user_mention} (`{assigned_user}`) web sitesi üzerinden başarıyla bakiye yükledi!",
                "color": 0x10B981,
                "fields": [
                    {"name": "👤 Kullanıcı", "value": f"{user_mention}\n(`{assigned_user}`)", "inline": True},
                    {"name": "💰 Yüklenen Tutar", "value": f"**+{price:,.2f} ₺**", "inline": True},
                    {"name": "💳 Güncel Bakiye", "value": f"**{float(u_info_copy.get('balance', 0)):,.2f} ₺**", "inline": True},
                    {"name": "🧾 Sipariş No", "value": f"`ORD-{oid}`", "inline": True},
                    {"name": "🛡️ Entegrasyon", "value": "`Shopier 3D Secure Doğrulandı`", "inline": True},
                    {"name": "⏰ Tarih", "value": f"`{time.strftime('%d.%m.%Y %H:%M:%S')}`", "inline": True}
                ],
                "thumbnail": {"url": avatar_url},
                "footer": {"text": "BadSupDev Finansal Otomasyon Sistemi • Doğrulandı", "icon_url": BADSUPDEV_LOGO_URL}
            }]
        )

    return {
        "success": True,
        "newlyCredited": newly_credited_count,
        "activeBalance": active_balance
    }

def background_shopier_worker():
    """Continuously checks for completed payments in the background every 3 seconds."""
    time.sleep(2)
    print("[Shopier Worker] 7/24 Kesintisiz otomatik odeme dinleyicisi devrede.")
    while True:
        try:
            sync_shopier_orders_for_user()
        except Exception as e:
            pass
        time.sleep(3)

class BadSupHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        # Route /store -> redirect to root / or www.badsupdev.xyz
        if path == '/store' or path == '/store/' or path.startswith('/store/'):
            host = self.headers.get('Host', '')
            target = 'https://www.badsupdev.xyz/' if 'badsupdev' in host else '/'
            self.send_response(302)
            self.send_header('Location', target)
            self.end_headers()
            return

        # Route /admin -> serve admin.html directly
        if path == '/admin' or path == '/admin/':
            admin_file = os.path.join(BASE_DIR, "admin.html")
            if os.path.exists(admin_file):
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.end_headers()
                with open(admin_file, 'rb') as f:
                    self.wfile.write(f.read())
                return
            else:
                self.send_error(404, "admin.html bulunamadi")
                return

        # Discord OAuth2 Initiate URL
        if path == '/api/auth/discord/login':
            return self.send_json({"url": DISCORD_AUTH_URL})

        # Discord OAuth2 Handler (supports both /api/discord/login and /api/auth/callback/discord)
        if path == '/api/discord/login' or path == '/api/auth/callback/discord':
            code = query.get('code', [None])[0]
            
            # If accessed directly without code, redirect to Discord authorization page
            if not code:
                self.send_response(302)
                self.send_header('Location', DISCORD_AUTH_URL)
                self.end_headers()
                return

            try:
                # Callback matching redirect_uri
                host_hdr = self.headers.get('Host', '')
                if 'badsupdev.xyz' in host_hdr:
                    callback_uri = "https://badsupdev.xyz/api/discord/login"
                else:
                    callback_uri = f"http://localhost:{PORT}/api/discord/login" if path == '/api/discord/login' else f"http://localhost:{PORT}/api/auth/callback/discord"
                token_data = urllib.parse.urlencode({
                    'client_id': DISCORD_CLIENT_ID,
                    'client_secret': DISCORD_CLIENT_SECRET,
                    'grant_type': 'authorization_code',
                    'code': code,
                    'redirect_uri': callback_uri
                }).encode('utf-8')

                ua_header = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
                token_req = urllib.request.Request(
                    'https://discord.com/api/v10/oauth2/token',
                    data=token_data,
                    headers={
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'User-Agent': ua_header,
                        'Accept': 'application/json'
                    }
                )
                with urllib.request.urlopen(token_req, timeout=10) as resp:
                    tokens = json.loads(resp.read().decode('utf-8'))

                access_token = tokens.get('access_token')

                # Fetch Discord User Profile
                user_req = urllib.request.Request(
                    'https://discord.com/api/v10/users/@me',
                    headers={
                        'Authorization': f'Bearer {access_token}',
                        'User-Agent': ua_header,
                        'Accept': 'application/json'
                    }
                )
                with urllib.request.urlopen(user_req) as resp:
                    discord_user = json.loads(resp.read().decode('utf-8'))

                username = discord_user.get('username')
                global_name = discord_user.get('global_name') or username
                u_id = discord_user.get('id')
                avatar = discord_user.get('avatar')
                email = discord_user.get('email')

                avatar_url = f"https://cdn.discordapp.com/avatars/{u_id}/{avatar}.png?size=128" if avatar else "https://cdn.discordapp.com/embed/avatars/0.png"

                # Update or register user in DB
                db = load_db()
                users = db.setdefault('users', {})
                user_info = users.setdefault(username, {'balance': 0.0, 'purchases': []})
                user_info['discordId'] = u_id
                user_info['globalName'] = global_name
                user_info['avatar'] = avatar_url
                if email:
                    user_info['email'] = email
                save_db(db)

                print(f"[Discord OAuth] Basariyla giris yapildi: {username} ({global_name}) - ID: {u_id}")

                # Discord Webhook: General Weblog (Login)
                send_general_webhook(
                    content=f"<@{u_id}> 🌐 **KULLANICI GİRİŞ YAPTI**",
                    embeds=[{
                        "title": "🌐 Kullanıcı Web Sitesine Giriş Yaptı",
                        "description": f"<@{u_id}> (`{username}`) Discord hesabı ile başarıyla giriş yaptı.",
                        "color": 0x5865F2,
                        "fields": [
                            {"name": "👤 Kullanıcı", "value": f"<@{u_id}>\n(`{username}`)", "inline": True},
                            {"name": "🆔 Discord ID", "value": f"`{u_id}`", "inline": True},
                            {"name": "💳 Mevcut Bakiye", "value": f"**{float(user_info.get('balance', 0)):,.2f} ₺**", "inline": True},
                            {"name": "⏰ Giriş Zamanı", "value": f"`{time.strftime('%d.%m.%Y %H:%M:%S')}`", "inline": True}
                        ],
                        "thumbnail": {"url": avatar_url},
                        "footer": {"text": "BadSupDev Web Güvenlik & Log Sistemi", "icon_url": BADSUPDEV_LOGO_URL}
                    }]
                )

                host_hdr = self.headers.get('Host', '')
                base_redirect = f"https://{host_hdr}" if 'badsupdev.xyz' in host_hdr else ""
                redirect_target = (
                    f"{base_redirect}/?discord_auth=success"
                    f"&user={urllib.parse.quote(username)}"
                    f"&name={urllib.parse.quote(global_name)}"
                    f"&avatar={urllib.parse.quote(avatar_url)}"
                    f"&id={u_id}"
                )
                self.send_response(302)
                self.send_header('Location', redirect_target)
                self.end_headers()
                return

            except Exception as e:
                print("Discord OAuth Error:", e)
                redirect_target = f"/?discord_auth=error&msg={urllib.parse.quote(str(e))}#home"
                self.send_response(302)
                self.send_header('Location', redirect_target)
                self.end_headers()
                return

        # API: Products List
        if path == '/api/products':
            db = load_db()
            deleted_ids = set(db.get("deletedProductIds", []))
            active_prods = [p for p in db.get("products", []) if p.get("id") and p.get("id") not in deleted_ids]
            return self.send_json({"success": True, "products": active_prods})

        # API: User Data (Balance, Purchases, Profile Auto-Registration)
        if path == '/api/user-data':
            username = query.get('user', [''])[0].strip()
            discord_id = query.get('id', [''])[0].strip()
            avatar = query.get('avatar', [''])[0].strip()
            global_name = query.get('name', [''])[0].strip()
            email = query.get('email', [''])[0].strip()

            if not username:
                return self.send_json({"error": "User required"}, 400)
            with DB_LOCK:
                db = load_db()
                users = db.setdefault("users", {})
                matched = username
                if username not in users:
                    for k in users.keys():
                        if k.lower() == username.lower():
                            matched = k
                            break
                    if matched not in users:
                        users[username] = {
                            "balance": 0.0,
                            "purchases": [],
                            "discordId": discord_id or None,
                            "globalName": global_name or username,
                            "avatar": avatar or None,
                            "email": email or None,
                            "createdAt": time.strftime("%Y-%m-%d %H:%M:%S")
                        }
                        matched = username
                        save_db(db)

                user_info = users[matched]
                updated = False
                if discord_id and user_info.get("discordId") != discord_id:
                    user_info["discordId"] = discord_id
                    updated = True
                if avatar and user_info.get("avatar") != avatar:
                    user_info["avatar"] = avatar
                    updated = True
                if global_name and user_info.get("globalName") != global_name:
                    user_info["globalName"] = global_name
                    updated = True
                if email and user_info.get("email") != email:
                    user_info["email"] = email
                    updated = True
                if updated:
                    save_db(db)
            return self.send_json({"success": True, "user": matched, "data": user_info})

        # API: Active Giveaway & History
        if path == '/api/giveaway/active':
            db = load_db()
            gws = db.get("giveaways", [])
            active_gw = None
            for g in gws:
                if g.get("status") == "active":
                    active_gw = g
                    break
            completed_gws = [g for g in gws if g.get("status") == "ended"][:5]
            return self.send_json({
                "success": True,
                "giveaway": active_gw,
                "pastGiveaways": completed_gws
            })

        # API: Support Tickets List (User / Admin)
        if path == '/api/support/tickets':
            db = load_db()
            user_filter = query.get('user', [''])[0].strip().lower()
            discord_id_filter = query.get('discordId', [''])[0].strip()
            tickets = db.get("tickets", [])
            if user_filter:
                tickets = [
                    t for t in tickets 
                    if t.get("user", "").lower() == user_filter 
                    or (discord_id_filter and discord_id_filter != "-" and str(t.get("discordId")) == discord_id_filter)
                ]
            return self.send_json({"success": True, "tickets": tickets})

        # API: Single Support Ticket with Messages
        if path == '/api/support/ticket':
            t_id = query.get('id', [''])[0].strip()
            db = load_db()
            tickets = db.get("tickets", [])
            target = next((t for t in tickets if t.get("id") == t_id), None)
            if not target:
                return self.send_json({"success": False, "error": "Talep bulunamadı"}, 404)
            return self.send_json({"success": True, "ticket": target})

        # API: Balance Sync with Shopier
        if path == '/api/balance/sync-shopier':
            username = query.get('user', [''])[0]
            res = sync_shopier_orders_for_user(username)
            return self.send_json(res)

        # API: Admin Key Query / License Lookup
        if path == '/api/admin/query-key':
            raw_key = query.get("key", [""])[0].strip().replace('"', "").replace("'", "").upper()
            if not raw_key:
                return self.send_json({"success": False, "found": False, "error": "Key parametresi eksik"}, 400)

            with DB_LOCK:
                db = load_db()
                users = db.get("users", {})
                orders = db.get("orders", [])

            # 1. Search in orders (Exact match)
            matched_order = next((o for o in orders if (o.get("key") and o.get("key").strip().upper() == raw_key) or (o.get("id") and o.get("id").strip().upper() == raw_key)), None)

            # 2. Search in user purchases (Exact match)
            matched_user = None
            matched_purchase = None
            if not matched_order:
                for u_name, u_info in users.items():
                    p = next((x for x in u_info.get("purchases", []) if (x.get("key") and x.get("key").strip().upper() == raw_key) or (x.get("orderId") and x.get("orderId").strip().upper() == raw_key)), None)
                    if p:
                        matched_user = u_name
                        matched_purchase = p
                        break

            # 3. Flexible Substring Search (if partial key or no BADSUP- prefix was provided)
            if not matched_order and not matched_purchase and len(raw_key) >= 4:
                for o in orders:
                    if (o.get("key") and raw_key in o.get("key").strip().upper()) or (o.get("id") and raw_key in o.get("id").strip().upper()):
                        matched_order = o
                        break
                if not matched_order:
                    for u_name, u_info in users.items():
                        for p in u_info.get("purchases", []):
                            if (p.get("key") and raw_key in p.get("key").strip().upper()) or (p.get("orderId") and raw_key in p.get("orderId").strip().upper()):
                                matched_user = u_name
                                matched_purchase = p
                                break
                        if matched_purchase:
                            break

            if matched_order or matched_purchase:
                u_name = matched_order.get("user") if matched_order else matched_user
                u_data = users.get(u_name, {})
                result_obj = {
                    "key": (matched_order.get("key") if matched_order else None) or (matched_purchase.get("key") if matched_purchase else raw_key),
                    "productTitle": (matched_order.get("product") if matched_order else None) or (matched_purchase.get("productTitle") if matched_purchase else "Lisanslı Ürün"),
                    "price": (matched_order.get("price") if matched_order else None) or (matched_purchase.get("price") if matched_purchase else 0),
                    "date": (matched_order.get("date") if matched_order else None) or (matched_purchase.get("date") if matched_purchase else "-"),
                    "user": u_name,
                    "discordId": u_data.get("discordId", "-"),
                    "globalName": u_data.get("globalName", u_name),
                    "avatar": u_data.get("avatar", ""),
                    "email": u_data.get("email", "-"),
                    "orderId": (matched_order.get("id") if matched_order else None) or (matched_purchase.get("orderId") if matched_purchase else "-"),
                    "status": "Geçerli & Doğrulanmış Lisans"
                }
                # Webhook: Web Admin Log
                send_admin_webhook(
                    embeds=[{
                        "title": "🔍 Admin Lisans / Key Sorgulama",
                        "description": f"Admin paneli üzerinden lisans anahtarı sorgulaması yapıldı.",
                        "color": 0x06B6D4,
                        "fields": [
                            {"name": "🔑 Sorgulanan Key", "value": f"```{raw_key}```", "inline": False},
                            {"name": "📊 Durum", "value": "✅ **Geçerli & Doğrulanmış Lisans**", "inline": True},
                            {"name": "📦 Ürün", "value": f"**{result_obj.get('productTitle', '-')}**", "inline": True},
                            {"name": "👤 Lisans Sahibi", "value": f"`{result_obj.get('user', '-')}`", "inline": True},
                            {"name": "🧾 Sipariş No", "value": f"`{result_obj.get('orderId', '-')}`", "inline": True},
                            {"name": "🕒 Tarih", "value": time.strftime("%d.%m.%Y %H:%M:%S"), "inline": True}
                        ],
                        "footer": {"text": "BadSupDev Admin Key Kontrol Logu"}
                    }]
                )
                return self.send_json({"success": True, "found": True, "result": result_obj})
            else:
                return self.send_json({"success": True, "found": False, "message": "Lisans anahtarı bulunamadı"})

        # API: Admin Stats
        if path == '/api/admin/stats':
            db = load_db()
            deleted_ids = set(db.get("deletedProductIds", []))
            active_prods = [p for p in db.get("products", []) if p.get("id") and p.get("id") not in deleted_ids]
            total_users = len(db.get("users", {}))
            total_orders = len(db.get("orders", []))
            total_products = len(active_prods)
            total_balance = sum(u.get("balance", 0) for u in db.get("users", {}).values() if isinstance(u, dict))
            return self.send_json({
                "success": True,
                "stats": {
                    "totalUsers": total_users,
                    "totalOrders": total_orders,
                    "totalProducts": total_products,
                    "totalBalance": total_balance
                },
                "users": db.get("users", {}),
                "orders": db.get("orders", []),
                "products": active_prods,
                "tickets": db.get("tickets", []),
                "giveaways": db.get("giveaways", [])
            })

        # API: Admin Shopier Temporary Product Cleanup
        if path == '/api/admin/shopier/cleanup':
            res = sync_shopier_orders_for_user()
            return self.send_json({"success": True, "message": "Shopier geçici ürünleri temizlendi", "details": res})

        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # Read JSON body
        content_len = int(self.headers.get('Content-Length', 0))
        body_bytes = self.rfile.read(content_len)
        try:
            body = json.loads(body_bytes.decode('utf-8')) if body_bytes else {}
        except Exception:
            body = {}

        # API: Admin Login
                # API: User Logout Webhook Notification
        if path == '/api/auth/logout':
            user = body.get("user")
            if user:
                db = load_db()
                u_info = db.get("users", {}).get(user, {})
                send_general_webhook(
                    embeds=[{
                        "title": "🚪 Kullanıcı Çıkış Yaptı",
                        "description": f"**{user}** web sitesinden oturumunu sonlandırdı.",
                        "color": 0x64748B,
                        "fields": [
                            {"name": "👤 Kullanıcı", "value": f"`{user}`", "inline": True},
                            {"name": "🆔 Discord ID", "value": f"`{u_info.get('discordId', '-')}`", "inline": True},
                            {"name": "🕒 Tarih", "value": time.strftime("%d.%m.%Y %H:%M:%S"), "inline": True}
                        ],
                        "footer": {"text": "BadSupDev Oturum Logu"}
                    }]
                )
            return self.send_json({"success": True})

        if path == '/api/admin/login':
            username = (body.get('username') or '').strip()
            password = (body.get('password') or '').strip()
            valid_users = {'badsupdev'}
            valid_passwords = {
                'bAdSupDev^24)312',
                'BadSupDev^24)312',
                'badsupdev^24)312',
                'bAdSupDev24)312',
                'BadSupDev24)312',
                'badsupdev',
                'BadSupDev'
            }
            if username.lower() in valid_users and (password in valid_passwords or password.lower() == 'badsupdev'):
                # Webhook: Web Admin Log
                send_admin_webhook(
                    embeds=[{
                        "title": "🛡️ Admin Paneline Giriş Yapıldı",
                        "description": f"Yetkili kullanıcı **{username}** admin paneline başarıyla giriş yaptı.",
                        "color": 0x3B82F6,
                        "fields": [
                            {"name": "👤 Admin Kullanıcı", "value": f"`{username}`", "inline": True},
                            {"name": "🕒 Tarih / Saat", "value": time.strftime("%d.%m.%Y %H:%M:%S"), "inline": True}
                        ],
                        "footer": {"text": "BadSupDev Admin Güvenlik Sistemi"}
                    }]
                )
                return self.send_json({"success": True, "token": "badsupdev_admin_session_auth_token_2026"})
            return self.send_json({"success": False, "error": "Kullanıcı adı veya şifre hatalı!"}, 401)

        # API: Add / Update Product (Admin)
        if path == '/api/admin/products':
            db = load_db()
            products = db.setdefault("products", [])
            new_p = {
                "id": body.get("id") or f"prod-{int(time.time())}",
                "title": body.get("title", "Yeni Ürün"),
                "category": body.get("category", "FiveM Scriptleri"),
                "price": float(body.get("price", 100)),
                "period": body.get("period", "Tek Seferlik"),
                "badge": body.get("badge", "Yeni"),
                "description": body.get("description", ""),
                "features": body.get("features", ["Optimize Kod", "Anında Teslimat"]),
                "stock": int(body.get("stock", 50))
            }
            existing_idx = next((i for i, p in enumerate(products) if p["id"] == new_p["id"]), None)
            if existing_idx is not None:
                products[existing_idx] = new_p
            else:
                products.append(new_p)
            save_db(db)
            print(f"[Admin] Ürün kaydedildi: {new_p['id']} - {new_p['title']}")
            return self.send_json({"success": True, "product": new_p, "allProducts": products})

        # API: Delete Product (Admin)
        if path == '/api/admin/products/delete':
            pid = body.get('id')
            with DB_LOCK:
                db = load_db()
                deleted_ids = db.setdefault('deletedProductIds', [])
                if pid and pid not in deleted_ids:
                    deleted_ids.append(pid)
                products = db.setdefault('products', [])
                db['products'] = [p for p in products if p.get('id') != pid and p.get('id') not in deleted_ids]
                save_db(db)
            print(f'[Admin] Urun silindi: {pid} (Kalan urun: {len(db["products"])})')
            return self.send_json({'success': True, 'deletedId': pid, 'remaining': len(db['products'])})

        # API: Admin Balance Update
        if path == '/api/admin/update-balance':
            user = body.get("user")
            amount = float(body.get("amount", 0))
            op = body.get("op", "set")
            with DB_LOCK:
                db = load_db()
                users = db.setdefault("users", {})
                matched_user = user
                if user not in users:
                    for k in users.keys():
                        if k.lower() == (user or "").strip().lower():
                            matched_user = k
                            break
                if matched_user not in users:
                    for k, u_d in users.items():
                        if isinstance(u_d, dict):
                            if str(u_d.get("discordId", "")).strip() == str(user or "").strip():
                                matched_user = k
                                break
                            if str(u_d.get("globalName", "")).strip().lower() == str(user or "").strip().lower():
                                matched_user = k
                                break
                u_info = users.setdefault(matched_user, {"balance": 0.0, "purchases": []})
                old_balance = float(u_info.get("balance", 0.0))

                if op == "add":
                    new_balance = old_balance + amount
                    op_desc = f"+{amount:,.2f} ₺ Eklendi"
                elif op == "sub":
                    new_balance = max(0.0, old_balance - amount)
                    op_desc = f"-{amount:,.2f} ₺ Düşüldü"
                elif op == "reset":
                    new_balance = 0.0
                    op_desc = "Bakiyeyi Sıfırla (0.00 ₺ Yapıldı)"
                else:  # "set" -> doğrudan yazılan bakiye
                    new_balance = max(0.0, amount)
                    op_desc = f"Doğrudan {amount:,.2f} ₺ Olarak Belirlendi"

                u_info["balance"] = new_balance
                u_info["balanceUpdatedAt"] = int(time.time() * 1000)
                save_db(db)

            # Webhook: Web Admin Log
            send_admin_webhook(
                embeds=[{
                    "title": "⚡ Admin Bakiye İşlemi Gerçekleşti",
                    "description": f"Admin tarafından **{user}** kullanıcısının bakiyesinde işlem yapıldı.",
                    "color": 0x8B5CF6,
                    "fields": [
                        {"name": "👤 Hedef Kullanıcı", "value": f"`{user}`", "inline": True},
                        {"name": "🆔 Discord ID", "value": f"`{u_info.get('discordId', '-')}`", "inline": True},
                        {"name": "⚙️ İşlem Türü", "value": f"**{op_desc}**", "inline": True},
                        {"name": "📉 Eski Bakiye", "value": f"**{old_balance:,.2f} ₺**", "inline": True},
                        {"name": "📈 Yeni Bakiye", "value": f"**{new_balance:,.2f} ₺**", "inline": True},
                        {"name": "🕒 Tarih", "value": time.strftime("%d.%m.%Y %H:%M:%S"), "inline": True}
                    ],
                    "thumbnail": {"url": u_info.get("avatar") or BADSUPDEV_LOGO_URL},
                    "footer": {"text": "BadSupDev Admin Güvenlik Denetimi"}
                }]
            )

            return self.send_json({"success": True, "user": matched_user, "oldBalance": old_balance, "newBalance": new_balance, "diff": new_balance - old_balance, "opDesc": op_desc})

        # API: Balance Sync with Shopier (POST support)
        if path == '/api/balance/sync-shopier':
            username = body.get('user', '')
            res = sync_shopier_orders_for_user(username)
            return self.send_json(res)

        # API: Admin Shopier Cleanup
        if path == '/api/admin/shopier/cleanup':
            res = sync_shopier_orders_for_user()
            return self.send_json({"success": True, "message": "Shopier geçici ürünleri temizlendi", "details": res})

        # API: Create Shopier Payment (Bakiye Yükleme)
        if path == '/api/shopier/create-payment':
            amount = float(body.get("amount", 0))
            user = body.get("user", "Misafir")

            if amount < 10.0:
                return self.send_json({"success": False, "error": "Minimum bakiye yükleme tutarı 10 TL'dir."}, 400)

            db = load_db()
            token = db.get("shopierToken")
            shopier_url = None
            shopier_id = None

            try:
                shopier_req_body = json.dumps({
                    "title": f"BadSupDev Bakiye Yukleme ({int(amount) if amount.is_integer() else amount} TL)",
                    "description": f"Kullanici: {user} | BadSupDev Bakiye Yukleme",
                    "type": "digital",
                    "media": [{
                        "type": "image",
                        "url": BADSUPDEV_LOGO_URL,
                        "placement": 1
                    }],
                    "priceData": {
                        "currency": "TRY",
                        "price": float(amount)
                    },
                    "stockQuantity": 9999,
                    "shippingPayer": "sellerPays"
                }).encode('utf-8')

                req = urllib.request.Request("https://api.shopier.com/v1/products", data=shopier_req_body, headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "User-Agent": "BadSupDev/1.0"
                }, method='POST')

                with urllib.request.urlopen(req, timeout=8) as resp:
                    resp_data = json.loads(resp.read().decode('utf-8'))
                    shopier_url = resp_data.get("url")
                    shopier_id = str(resp_data.get("id"))
                    print(f"[Shopier API] Canlı ürün oluşturuldu: #{shopier_id} -> {shopier_url}")

                    # Track temporary product in DB with username so auto-sync links it immediately
                    temp_list = db.setdefault("temporary_shopier_products", [])
                    temp_list.append({"id": shopier_id, "user": user, "amount": amount, "time": time.time()})
                    save_db(db)

            except Exception as e:
                print("[Shopier API] Hata, doğrudan Shopier linkine yönlendiriliyor:", e)
                shopier_url = "https://www.shopier.com/51665777"

            return self.send_json({
                "success": True,
                "amount": amount,
                "url": shopier_url or "https://www.shopier.com/51665777",
                "productId": shopier_id,
                "user": user
            })

        # API: Buy Product from Market with Balance
        if path == '/api/products/buy':
            user = body.get("user")
            pid = body.get("productId")
            if not user or not pid:
                return self.send_json({"error": "Eksik parametre"}, 400)

            with DB_LOCK:
                db = load_db()
                users = db.setdefault("users", {})
                
                # Case-insensitive user lookup
                matched_user = user
                if user not in users:
                    for k in users.keys():
                        if k.lower() == user.lower():
                            matched_user = k
                            break

                u_info = users.setdefault(matched_user, {"balance": 0.0, "purchases": []})
                products = db.get("products", [])
                product = next((p for p in products if p.get("id") == pid), None)

                # Fallback to default catalog if product was not in db.json products
                if not product:
                    default_products = [
                        {"id": "fivem-ultimate-v2", "title": "BadSupDev Full V2 FiveM Sunucu Paketi", "price": 2500.0},
                        {"id": "discord-guard-bot", "title": "Gelişmiş Guard & Sunucu Koruma Botu", "price": 650.0},
                        {"id": "custom-inventory-hud", "title": "Custom Glassmorphism QB/ESX Envanter Scripti", "price": 450.0},
                        {"id": "premium-web-design", "title": "Full Responsive Web & Discord Tasarımı", "price": 1200.0}
                    ]
                    product = next((p for p in default_products if p.get("id") == pid), None)

                if not product:
                    return self.send_json({"error": "Ürün bulunamadı"}, 404)

                price = float(product.get("price", 0))
                current_bal = float(u_info.get("balance", 0.0))
                if current_bal < price:
                    missing = price - current_bal
                    return self.send_json({
                        "error": f"Yetersiz bakiye! Bu ürünü almak için {missing:.2f} ₺ daha bakiye yüklemelisiniz.",
                        "missing": missing,
                        "balance": current_bal,
                        "price": price
                    }, 400)

                # DEDUCT BALANCE!
                new_balance = max(0.0, current_bal - price)
                u_info["balance"] = new_balance

                generated_key = f"BADSUP-{uuid.uuid4().hex[:4].upper()}-{uuid.uuid4().hex[:4].upper()}-{uuid.uuid4().hex[:4].upper()}"

                purchase_record = {
                    "orderId": f"KEY-{int(time.time())}-{uuid.uuid4().hex[:4]}",
                    "productId": pid,
                    "productTitle": product["title"],
                    "price": price,
                    "key": generated_key,
                    "date": time.strftime("%Y-%m-%d %H:%M:%S")
                }
                u_info.setdefault("purchases", []).append(purchase_record)
                db.setdefault("orders", []).append({
                    "id": purchase_record["orderId"],
                    "user": matched_user,
                    "type": "urun_satisi",
                    "product": product["title"],
                    "price": price,
                    "key": generated_key,
                    "date": purchase_record["date"]
                })
                save_db(db)

            # Webhook: Web Sales Log
            u_discord_id = u_info.get('discordId') or ''
            has_u_discord = bool(u_discord_id and str(u_discord_id).isdigit())
            u_mention = f"<@{u_discord_id}>" if has_u_discord else f"`{matched_user}`"
            u_avatar = u_info.get('avatar') or BADSUPDEV_LOGO_URL
            content_buy = f"<@{u_discord_id}> 🛒 **YENİ ÜRÜN SATIN ALIMI GERÇEKLEŞTİ!**" if has_u_discord else "🛒 **YENİ ÜRÜN SATIN ALIMI GERÇEKLEŞTİ!**"
            send_sales_webhook(
                content=content_buy,
                embeds=[{
                    "title": "🛒 Yeni Ürün Satın Alındı & Lisans Teslim Edildi!",
                    "description": f"{u_mention} (`{matched_user}`) az önce marketten bir ürün satın aldı ve adına lisans üretildi.",
                    "color": 0x6366F1,
                    "fields": [
                        {"name": "👤 Müşteri", "value": f"{u_mention}\n(`{matched_user}`)", "inline": True},
                        {"name": "📦 Ürün", "value": f"**{product['title']}**", "inline": True},
                        {"name": "💰 Fiyat", "value": f"**{price:,.2f} ₺**", "inline": True},
                        {"name": "🔑 Lisans Anahtarı", "value": f"```{generated_key}```", "inline": False},
                        {"name": "🧾 Sipariş No", "value": f"`{purchase_record['orderId']}`", "inline": True},
                        {"name": "💳 Kalan Bakiye", "value": f"**{float(new_balance):,.2f} ₺**", "inline": True},
                        {"name": "⏰ Tarih", "value": f"`{purchase_record['date']}`", "inline": True}
                    ],
                    "thumbnail": {"url": u_avatar},
                    "footer": {"text": "BadSupDev Satış & Lisanslama Sistemi", "icon_url": BADSUPDEV_LOGO_URL}
                }]
            )

            return self.send_json({
                "success": True,
                "key": generated_key,
                "productTitle": product["title"],
                "newBalance": new_balance,
                "orderId": purchase_record["orderId"]
            })


        # API: User Auto-Register / Sync
        if path == '/api/user/register' or path == '/api/user/sync':
            u_name = (body.get("user") or "").strip()
            if not u_name:
                return self.send_json({"error": "User required"}, 400)
            d_id = body.get("discordId") or body.get("id")
            g_name = body.get("globalName") or body.get("name") or u_name
            av = body.get("avatar")
            em = body.get("email")

            with DB_LOCK:
                db = load_db()
                users = db.setdefault("users", {})
                matched = u_name
                for k in users.keys():
                    if k.lower() == u_name.lower():
                        matched = k
                        break
                if matched not in users:
                    users[u_name] = {
                        "balance": 0.0,
                        "purchases": [],
                        "discordId": d_id,
                        "globalName": g_name,
                        "avatar": av,
                        "email": em,
                        "createdAt": time.strftime("%Y-%m-%d %H:%M:%S")
                    }
                    matched = u_name
                else:
                    u_rec = users[matched]
                    if d_id: u_rec["discordId"] = d_id
                    if g_name: u_rec["globalName"] = g_name
                    if av: u_rec["avatar"] = av
                    if em: u_rec["email"] = em
                save_db(db)
            return self.send_json({"success": True, "user": matched, "data": users[matched]})

        # API: Support Ticket Submission (with Messages & Photo Attachments)
        if path == '/api/support/ticket':
            u_name = (body.get("user") or "Misafir").strip()
            d_id = body.get("discordId") or "-"
            cat = body.get("category") or "Genel"
            subj = (body.get("subject") or "Destek Talebi").strip()
            msg = (body.get("message") or "").strip()
            av = body.get("avatar") or ""
            img = body.get("image") or None
            priority = body.get("priority") or "Normal" 

            if not msg and not img:
                return self.send_json({"success": False, "error": "Lütfen bir mesaj yazınız veya görsel ekleyiniz."}, 400)

            t_id = f"TCK-{int(time.time() * 1000)}"
            now_str = time.strftime("%Y-%m-%d %H:%M:%S")

            initial_msg = {
                "id": f"MSG-{int(time.time()*1000)}",
                "sender": "user",
                "senderName": u_name,
                "avatar": av,
                "text": msg,
                "image": img,
                "timestamp": now_str
            }

            ticket = {
                "id": t_id,
                "user": u_name,
                "discordId": d_id,
                "avatar": av,
                "category": cat,
                "priority": priority,
                "subject": subj,
                "message": msg,
                "status": "Açık",
                "createdAt": now_str,
                "updatedAt": now_str,
                "messages": [initial_msg]
            }

            with DB_LOCK:
                db = load_db()
                db.setdefault("tickets", []).insert(0, ticket)
                save_db(db)

            # Send Webhook
            has_ticket_discord = bool(d_id and str(d_id).isdigit())
            ticket_user_mention = f"<@{d_id}>" if has_ticket_discord else f"`{u_name}`"
            ticket_avatar = av or BADSUPDEV_LOGO_URL
            content_ticket = f"<@{d_id}> 🎫 **YENİ DESTEK TALEBİ OLUŞTURULDU!**" if has_ticket_discord else "🎫 **YENİ DESTEK TALEBİ OLUŞTURULDU!**"
            webhook_embed = {
                "title": "🎫 Yeni Destek Talebi Açıldı",
                "description": f"{ticket_user_mention} (`{u_name}`) web sitesi üzerinden yeni bir destek talebi başlattı.",
                "color": 0x00F0FF,
                "fields": [
                    {"name": "👤 Kullanıcı", "value": f"{ticket_user_mention}\n(`{u_name}`)", "inline": True},
                    {"name": "📁 Kategori", "value": f"**{cat}**", "inline": True},
                    {"name": "⚡ Öncelik", "value": f"**{priority}**", "inline": True},
                    {"name": "📌 Konu", "value": f"**{subj}**", "inline": False},
                    {"name": "💬 İlk Mesaj", "value": f"```{msg[:1000] if msg else '[Görsel Paylaşıldı]'}```", "inline": False},
                    {"name": "⏰ Tarih", "value": f"`{now_str}`", "inline": True},
                    {"name": "⚡ Durum", "value": "`🟢 Açık`", "inline": True}
                ],
                "thumbnail": {"url": ticket_avatar},
                "footer": {"text": f"Talep No: {t_id} • BadSupDev Canlı Destek", "icon_url": BADSUPDEV_LOGO_URL}
            }
            if img and img.startswith("http"):
                webhook_embed["image"] = {"url": img}
            elif img and img.startswith("data:image"):
                webhook_embed["fields"].append({"name": "🖼️ Eklenen Fotoğraf", "value": "Görsel sisteme yüklendi ve panelde görüntülenebilir.", "inline": False})

            send_general_webhook(content=content_ticket, embeds=[webhook_embed])

            return self.send_json({
                "success": True,
                "message": "Destek talebiniz başarıyla oluşturuldu! Canlı metin kanalından mesajlaşabilirsiniz.",
                "ticket": ticket
            })

        # API: Support Ticket Send Message (Live Chat Channel)
        if path == '/api/support/message':
            t_id = body.get("ticketId")
            sender = body.get("sender") or "user" # "user" or "admin"
            sender_name = (body.get("senderName") or "").strip()
            text = (body.get("text") or "").strip()
            av = body.get("avatar") or ""
            img = body.get("image") or None

            if not t_id:
                return self.send_json({"success": False, "error": "Ticket ID required"}, 400)
            if not text and not img:
                return self.send_json({"success": False, "error": "Mesaj veya görsel gereklidir"}, 400)

            with DB_LOCK:
                db = load_db()
                tickets = db.setdefault("tickets", [])
                target = next((t for t in tickets if t.get("id") == t_id), None)
                if not target:
                    return self.send_json({"success": False, "error": "Talep bulunamadı"}, 404)

                current_status = target.get("status", "Açık")
                if (current_status in ["Kapatıldı", "Kapalı", "closed"]) and sender == "user":
                    return self.send_json({"success": False, "error": "Bu destek talebi kapatılmıştır. Mesaj gönderilemez."}, 400)
                if current_status == "Duraklatıldı" and sender == "user":
                    return self.send_json({"success": False, "error": "Bu talep duraklatılmıştır. Lütfen yetkili incelemesini bekleyiniz."}, 400)

                now_str = time.strftime("%Y-%m-%d %H:%M:%S")
                if not sender_name:
                    sender_name = target.get("user", "Kullanıcı") if sender == "user" else "🛡️ BadSupDev Destek"

                msg_obj = {
                    "id": f"MSG-{int(time.time()*1000)}",
                    "sender": sender,
                    "senderName": sender_name,
                    "avatar": av or (target.get("avatar") if sender == "user" else BADSUPDEV_LOGO_URL),
                    "text": text,
                    "image": img,
                    "timestamp": now_str
                }

                target.setdefault("messages", []).append(msg_obj)
                target["updatedAt"] = now_str
                if sender == "admin":
                    target["status"] = "Yetkili Yanıtladı"
                elif sender == "user":
                    if target.get("status") not in ["Açık", "Yetkili Yanıtladı"]:
                        target["status"] = "Açık"

                save_db(db)

            # Send Discord Webhook Notification
            log_title = f"💬 [Ticket #{t_id}] Yetkili Yanıt Verdi" if sender == "admin" else f"💬 [Ticket #{t_id}] Kullanıcı Mesaj Yazdı"
            log_color = 0x10B981 if sender == "admin" else 0x38BDF8
            msg_embed = {
                "title": log_title,
                "description": f"**{sender_name}**: {text[:1000] if text else '[Fotoğraf Eklendi]'}",
                "color": log_color,
                "fields": [
                    {"name": "📌 Konu", "value": f"**{target.get('subject', '-')}**", "inline": True},
                    {"name": "👤 Gönderen", "value": f"`{sender_name}` ({'Yetkili' if sender == 'admin' else 'Kullanıcı'})", "inline": True},
                    {"name": "🕒 Zaman", "value": now_str, "inline": True}
                ],
                "footer": {"text": f"Talep No: {t_id} • BadSupDev Canlı Destek"}
            }
            if img and img.startswith("http"):
                msg_embed["image"] = {"url": img}
            elif img and img.startswith("data:image"):
                msg_embed["fields"].append({"name": "📷 Görsel", "value": "Kullanıcı/Yetkili sohbete bir ekran görüntüsü yükledi.", "inline": False})

            send_general_webhook(embeds=[msg_embed])

            return self.send_json({
                "success": True,
                "message": "Mesaj iletildi",
                "chatMessage": msg_obj,
                "ticket": target
            })

        # API: Giveaway Join
        if path == '/api/giveaway/join':
            u_name = (body.get("user") or "").strip()
            d_id = str(body.get("discordId") or "").strip()
            av = body.get("avatar") or ""

            if not u_name:
                return self.send_json({"success": False, "error": "Çekilişe katılmak için Discord hesabınızla giriş yapmalısınız."}, 400)

            with DB_LOCK:
                db = load_db()
                gws = db.setdefault("giveaways", [])
                active_gw = None
                for g in gws:
                    if g.get("status") == "active":
                        active_gw = g
                        break

                if not active_gw:
                    return self.send_json({"success": False, "error": "Şu anda aktif bir çekiliş bulunmuyor."}, 400)

                participants = active_gw.setdefault("participants", [])
                already = False
                for p in participants:
                    if (d_id and d_id != "-" and str(p.get("discordId")) == d_id) or p.get("user", "").lower() == u_name.lower():
                        already = True
                        break

                if already:
                    return self.send_json({"success": False, "error": "Bu çekilişe zaten katıldınız!", "alreadyJoined": True})

                participants.append({
                    "user": u_name,
                    "discordId": d_id or "-",
                    "avatar": av,
                    "joinedAt": time.strftime("%Y-%m-%d %H:%M:%S")
                })
                save_db(db)

            return self.send_json({
                "success": True,
                "message": "Çekilişe başarıyla katıldınız! Bol şans dileriz!",
                "participantCount": len(participants)
            })

        # API: Admin Giveaway Create
        if path == '/api/admin/giveaway/create':
            title = (body.get("title") or "Büyük Çekiliş").strip()
            prize = (body.get("prize") or title).strip()
            desc = (body.get("description") or "").strip()
            winner_count = int(body.get("winnerCount") or 1)
            duration_minutes = int(body.get("durationMinutes") or 1440)

            now_ts = int(time.time() * 1000)
            end_ts = now_ts + (duration_minutes * 60 * 1000)
            gw_id = f"GW-{int(time.time())}"
            now_str = time.strftime("%Y-%m-%d %H:%M:%S")

            new_gw = {
                "id": gw_id,
                "title": title,
                "prize": prize,
                "description": desc,
                "winnerCount": winner_count,
                "durationMinutes": duration_minutes,
                "endTime": end_ts,
                "status": "active",
                "createdAt": now_str,
                "participants": [],
                "winners": []
            }

            with DB_LOCK:
                db = load_db()
                gws = db.setdefault("giveaways", [])
                for g in gws:
                    if g.get("status") == "active":
                        g["status"] = "ended"
                gws.insert(0, new_gw)
                save_db(db)

            send_general_webhook(
                content="@everyone 🎉 **YENİ ÇEKİLİŞ BAŞLADI!**",
                embeds=[{
                    "title": f"🎉 {title}",
                    "description": f"{desc or 'BadSupDev tarafından yeni bir çekiliş başlatıldı!'}\n\n👉 **Hemen katılmak için sitemizi ziyaret edin:** https://badsupdev.xyz/",
                    "color": 0xF59E0B,
                    "fields": [
                        {"name": "🎁 Ödül", "value": f"**{prize}**", "inline": True},
                        {"name": "🏆 Kazanan Sayısı", "value": f"**{winner_count} Kişi**", "inline": True},
                        {"name": "⏳ Süre", "value": f"{duration_minutes} Dakika", "inline": True},
                        {"name": "🕒 Başlangıç", "value": now_str, "inline": True}
                    ],
                    "thumbnail": {"url": BADSUPDEV_LOGO_URL},
                    "footer": {"text": "BadSupDev Çekiliş Sistemi"}
                }]
            )

            return self.send_json({"success": True, "giveaway": new_gw, "message": "Çekiliş başarıyla başlatıldı ve Discord duyurusu paylaşıldı!"})

        # API: Admin Giveaway Draw
        if path == '/api/admin/giveaway/draw':
            gw_id = body.get("giveawayId")
            with DB_LOCK:
                db = load_db()
                gws = db.setdefault("giveaways", [])
                target_gw = None
                if gw_id:
                    for g in gws:
                        if g.get("id") == gw_id:
                            target_gw = g
                            break
                if not target_gw:
                    for g in gws:
                        if g.get("status") == "active":
                            target_gw = g
                            break

                if not target_gw:
                    return self.send_json({"success": False, "error": "Sonuçlandırılacak aktif bir çekiliş bulunamadı."}, 400)

                participants = target_gw.get("participants", [])
                if not participants:
                    return self.send_json({"success": False, "error": "Çekilişe henüz katılan kimse yok! Kazanan belirlenemedi."}, 400)

                w_count = min(int(target_gw.get("winnerCount") or 1), len(participants))
                selected_winners = random.sample(participants, w_count)

                target_gw["status"] = "ended"
                target_gw["winners"] = selected_winners
                target_gw["drawnAt"] = time.strftime("%Y-%m-%d %H:%M:%S")
                save_db(db)

            winner_mentions = []
            for w in selected_winners:
                d_id = w.get("discordId")
                if d_id and d_id != "-":
                    winner_mentions.append(f"<@{d_id}> (`{w.get('user')}`)")
                else:
                    winner_mentions.append(f"**{w.get('user')}**")
            w_text = "\n".join([f"🏆 {m}" for m in winner_mentions])

            send_general_webhook(
                content="@everyone 🎊 **ÇEKİLİŞ SONUÇLANDI!**",
                embeds=[{
                    "title": f"🎊 ÇEKİLİŞ KAZANANLARI: {target_gw['title']}",
                    "description": f"Çekilişimiz sona erdi! Kazanan şanslı üyelerimiz:\n\n{w_text}\n\nÖdülünüzü teslim almak için sitemizden **Destek Talebi Oluştur** yapabilir veya Discord yetkililerimize yazabilirsiniz!",
                    "color": 0x10B981,
                    "fields": [
                        {"name": "🎁 Ödül", "value": f"**{target_gw['prize']}**", "inline": True},
                        {"name": "👥 Toplam Katılımcı", "value": f"**{len(participants)} Kişi**", "inline": True},
                        {"name": "🕒 Çekiliş Tarihi", "value": target_gw["drawnAt"], "inline": True}
                    ],
                    "thumbnail": {"url": BADSUPDEV_LOGO_URL},
                    "footer": {"text": "Tebrikler! • BadSupDev"}
                }]
            )

            return self.send_json({
                "success": True,
                "message": "Çekiliş sonuçlandırıldı ve kazananlar Discord'da duyuruldu!",
                "winners": selected_winners,
                "giveaway": target_gw
            })

        # API: Admin Ticket Status Update (with System Message & Webhook Log)
        if path == '/api/admin/ticket/status':
            t_id = body.get("ticketId")
            new_status = body.get("status") or "Çözüldü"
            now_str = time.strftime("%Y-%m-%d %H:%M:%S")
            with DB_LOCK:
                db = load_db()
                tickets = db.setdefault("tickets", [])
                target = next((t for t in tickets if t.get("id") == t_id), None)
                if not target:
                    return self.send_json({"success": False, "error": "Talep bulunamadı"}, 404)

                target["status"] = new_status
                target["updatedAt"] = now_str

                # Append system notice to chat
                target.setdefault("messages", []).append({
                    "id": f"MSG-SYS-{int(time.time()*1000)}",
                    "sender": "system",
                    "senderName": "Sistem Bildirimi",
                    "text": f"📌 Destek talebinin durumu yetkili tarafından '{new_status}' olarak güncellendi.",
                    "timestamp": now_str
                })
                save_db(db)

            # Webhook log
            color_map = {
                "Açık": 0x3B82F6,
                "Yetkili Yanıtladı": 0x10B981,
                "Duraklatıldı": 0xF59E0B,
                "Çözüldü": 0x10B981,
                "Kapatıldı": 0xEF4444
            }
            send_general_webhook(
                embeds=[{
                    "title": f"⚙️ [Ticket #{t_id}] Durum Değiştirildi: {new_status}",
                    "description": f"**{target.get('user', 'Kullanıcı')}** kullanıcısının açtığı **{target.get('subject', '-')}** konulu talebin durumu güncellendi.",
                    "color": color_map.get(new_status, 0x64748B),
                    "fields": [
                        {"name": "📊 Yeni Durum", "value": f"**{new_status}**", "inline": True},
                        {"name": "👤 Kullanıcı", "value": f"`{target.get('user', '-')}`", "inline": True},
                        {"name": "🕒 Zaman", "value": now_str, "inline": True}
                    ],
                    "footer": {"text": f"Talep No: {t_id} • BadSupDev Destek Yönetimi"}
                }]
            )

            return self.send_json({"success": True, "ticketId": t_id, "status": new_status, "ticket": target})

        return self.send_json({"error": "Endpoint not found"}, 404)

class ThreadedTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    daemon_threads = True
    allow_reuse_address = True

def open_browser():
    time.sleep(1.0)
    webbrowser.open(f"http://localhost:{PORT}")

if __name__ == '__main__':
    print("========================================================")
    print("            BADSUPDEV MULTITHREADED WEB SUNUCUSU        ")
    print("========================================================")
    print(f"Port: {PORT}")
    print(f"Ana Sayfa: http://localhost:{PORT}")
    print(f"Yonetici Paneli: http://localhost:{PORT}/admin")
    print("Discord Bot OAuth2: Aktif")
    print("Shopier 7/24 Arka Plan Dinleyicisi: AKTIF")
    print("--------------------------------------------------------")

    # Start 24/7 background Shopier order listener
    threading.Thread(target=background_shopier_worker, daemon=True).start()

    with ThreadedTCPServer(("0.0.0.0", PORT), BadSupHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nSunucu kapatildi.")
