import logging
import asyncio
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any, Tuple

from config import DB_PATH, SUPABASE_URL, SUPABASE_KEY

logger = logging.getLogger(__name__)

# Check if Supabase is configured
USE_SUPABASE = bool(SUPABASE_URL and SUPABASE_KEY)
supabase_client = None

if USE_SUPABASE:
    try:
        from supabase import create_client, Client
        supabase_client: Optional[Client] = create_client(SUPABASE_URL, SUPABASE_KEY)
        logger.info("Connected to Supabase PostgreSQL cloud database.")
    except Exception as e:
        logger.warning(f"Could not initialize Supabase client: {e}. Falling back to SQLite.")
        USE_SUPABASE = False
        supabase_client = None

# If not using Supabase, import aiosqlite for local storage
if not USE_SUPABASE:
    import aiosqlite


# In-memory VIP cache for sub-millisecond guard checks across simultaneous channel joins
VIP_CACHE: set = set()


# ── 1. ዳታቤዝ ማስጀመር ────────────────────────────────────────────────────────
async def init_db():
    """Initializes tables and preloads active VIP users into memory cache."""
    if USE_SUPABASE:
        logger.info("Using Supabase cloud database.")
        def _sync_preload():
            try:
                res = supabase_client.table("users").select("user_id").eq("is_vip", 1).execute()
                for row in (res.data or []):
                    if row.get("user_id"):
                        VIP_CACHE.add(int(row["user_id"]))
                # Also load users with approved payments
                p_res = supabase_client.table("payments").select("user_id").eq("status", "approved").execute()
                for row in (p_res.data or []):
                    if row.get("user_id"):
                        VIP_CACHE.add(int(row["user_id"]))
                logger.info(f"Preloaded {len(VIP_CACHE)} VIP users into memory cache.")
            except Exception as e:
                logger.warning(f"Error preloading VIP cache from Supabase: {e}")
        await asyncio.to_thread(_sync_preload)
        return

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute('''
            CREATE TABLE IF NOT EXISTS users (
                user_id INTEGER PRIMARY KEY,
                username TEXT,
                full_name TEXT,
                phone TEXT,
                start_date TEXT,
                expiry_date TEXT,
                is_vip INTEGER DEFAULT 0
            )
        ''')
        await db.execute('''
            CREATE TABLE IF NOT EXISTS payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                payer_name TEXT,
                phone TEXT,
                transaction_id TEXT UNIQUE,
                amount REAL,
                bank TEXT,
                status TEXT DEFAULT 'approved',
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        await db.commit()
        async with db.execute("SELECT user_id FROM users WHERE is_vip = 1") as cur:
            for row in await cur.fetchall():
                VIP_CACHE.add(int(row[0]))
        async with db.execute("SELECT user_id FROM payments WHERE status = 'approved'") as cur:
            for row in await cur.fetchall():
                if row[0]:
                    VIP_CACHE.add(int(row[0]))
        logger.info(f"Preloaded {len(VIP_CACHE)} VIP users into SQLite memory cache.")


# ── 2. ተጠቃሚ መመዝገብ ወይም ማዘመን ──────────────────────────────────────────
async def add_user(user_id: int, username: str, full_name: str, phone: Optional[str] = None):
    if USE_SUPABASE:
        def _sync_add():
            payload = {
                "user_id": user_id,
                "username": username or "",
                "full_name": full_name or "",
                "updated_at": datetime.utcnow().isoformat(),
            }
            if phone:
                payload["phone"] = phone
            return supabase_client.table("users").upsert(payload, on_conflict="user_id").execute()
        await asyncio.to_thread(_sync_add)
        return

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute('''
            INSERT INTO users (user_id, username, full_name, phone)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
            username=excluded.username,
            full_name=excluded.full_name,
            phone=COALESCE(excluded.phone, users.phone)
        ''', (user_id, username, full_name, phone))
        await db.commit()


# ── 3. የተጠቃሚ ስልክ ቁጥር ማግኘት ─────────────────────────────────────────────
async def get_user_phone(user_id: int) -> Optional[str]:
    if USE_SUPABASE:
        def _sync_get():
            res = supabase_client.table("users").select("phone").eq("user_id", user_id).limit(1).execute()
            if res.data and len(res.data) > 0:
                return res.data[0].get("phone")
            return None
        return await asyncio.to_thread(_sync_get)

    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT phone FROM users WHERE user_id=?", (user_id,)) as cur:
            row = await cur.fetchone()
            return row[0] if row and row[0] else None


# ── 4. የተጠቃሚ ስልክ ቁጥር ማዘመን ─────────────────────────────────────────────
async def update_user_phone(user_id: int, phone: str):
    if USE_SUPABASE:
        def _sync_update():
            return supabase_client.table("users").update({"phone": phone, "updated_at": datetime.utcnow().isoformat()}).eq("user_id", user_id).execute()
        await asyncio.to_thread(_sync_update)
        return

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE users SET phone=? WHERE user_id=?", (phone, user_id))
        await db.commit()


# ── 5. ተጠቃሚ VIP መሆኑን ማረጋገጥ ───────────────────────────────────────────
async def is_user_vip(user_id: int) -> bool:
    uid = int(user_id)
    # Instant in-memory check (prevents race condition when joining 49 channels simultaneously)
    if uid in VIP_CACHE:
        return True

    if USE_SUPABASE:
        def _sync_vip():
            try:
                res = supabase_client.table("users").select("is_vip").eq("user_id", uid).limit(1).execute()
                if res.data and len(res.data) > 0:
                    val = res.data[0].get("is_vip")
                    if bool(val == 1 or val is True or val == "1"):
                        VIP_CACHE.add(uid)
                        return True
            except Exception as ex:
                logger.warning(f"Supabase is_vip check error: {ex}")

            # Fallback check on payments: if user has an approved payment, they are a paid VIP!
            try:
                pay_res = supabase_client.table("payments").select("id").eq("user_id", uid).eq("status", "approved").limit(1).execute()
                if pay_res.data and len(pay_res.data) > 0:
                    VIP_CACHE.add(uid)
                    try:
                        supabase_client.table("users").upsert({
                            "user_id": uid,
                            "is_vip": 1,
                            "updated_at": datetime.utcnow().isoformat()
                        }, on_conflict="user_id").execute()
                    except Exception:
                        pass
                    return True
            except Exception as ex:
                logger.warning(f"Supabase payment fallback check error: {ex}")
            return False
        return await asyncio.to_thread(_sync_vip)

    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT is_vip FROM users WHERE user_id=?", (uid,)) as cur:
            row = await cur.fetchone()
            if row and row[0] == 1:
                VIP_CACHE.add(uid)
                return True
        async with db.execute("SELECT id FROM payments WHERE user_id=? AND status='approved' LIMIT 1", (uid,)) as cur:
            p_row = await cur.fetchone()
            if p_row:
                VIP_CACHE.add(uid)
                await db.execute("UPDATE users SET is_vip=1 WHERE user_id=?", (uid,))
                await db.commit()
                return True
        return False


# ── 6. ተጠቃሚን VIP ማድረግ ──────────────────────────────────────────────────
async def activate_vip(user_id: int, duration_type: str):
    uid = int(user_id)
    # Add to memory cache immediately so guard never kicks them
    VIP_CACHE.add(uid)

    durations = {
        "5min": timedelta(minutes=5),
        "1month": timedelta(days=30),
        "2month": timedelta(days=60),
        "3month": timedelta(days=90),
        "6month": timedelta(days=180),
        "1year": timedelta(days=365)
    }
    delta = durations.get(duration_type, timedelta(days=30))
    now_utc = datetime.utcnow()
    start_now = now_utc.isoformat()
    expiry_now = (now_utc + delta).isoformat()

    if USE_SUPABASE:
        def _sync_activate():
            return supabase_client.table("users").upsert({
                "user_id": uid,
                "is_vip": 1,
                "start_date": start_now,
                "expiry_date": expiry_now,
                "updated_at": datetime.utcnow().isoformat()
            }, on_conflict="user_id").execute()
        await asyncio.to_thread(_sync_activate)
        return

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute('''
            INSERT INTO users (user_id, is_vip, start_date, expiry_date)
            VALUES (?, 1, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
            is_vip=1, start_date=excluded.start_date, expiry_date=excluded.expiry_date
        ''', (uid, start_now, expiry_now))
        await db.commit()


# ── 7. ተጠቃሚውን ከ VIP ማውጣት (Ban/Deactivate) ──────────────────────────────
async def deactivate_user(user_id: int):
    uid = int(user_id)
    VIP_CACHE.discard(uid)

    if USE_SUPABASE:
        def _sync_deact():
            return supabase_client.table("users").update({
                "is_vip": 0,
                "updated_at": datetime.utcnow().isoformat()
            }).eq("user_id", uid).execute()
        await asyncio.to_thread(_sync_deact)
        return

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE users SET is_vip=0 WHERE user_id=?", (uid,))
        await db.commit()


# ── 8. ሁሉንም VIP ተጠቃሚዎች ማውጣት ──────────────────────────────────────────
async def get_all_vip_users() -> List[Dict[str, Any]]:
    if USE_SUPABASE:
        def _sync_vips():
            res = supabase_client.table("users").select("*").eq("is_vip", 1).execute()
            return res.data or []
        return await asyncio.to_thread(_sync_vips)

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM users WHERE is_vip = 1") as cursor:
            return [dict(row) for row in await cursor.fetchall()]


# ── 9. ጊዜያቸው ያለቀባቸው ተጠቃሚዎች ─────────────────────────────────────────
async def get_expired_users() -> List[Dict[str, Any]]:
    now_iso = datetime.utcnow().isoformat()

    if USE_SUPABASE:
        def _sync_expired():
            res = supabase_client.table("users").select("*")\
                .eq("is_vip", 1)\
                .not_.is_("expiry_date", "null")\
                .lte("expiry_date", now_iso).execute()
            return res.data or []
        return await asyncio.to_thread(_sync_expired)

    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM users WHERE is_vip=1 AND expiry_date IS NOT NULL AND expiry_date<=?", (now_str,)
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]



# ── 10. ጊዜያቸው ሊያልቅ የቀረባቸው ተጠቃሚዎች ──────────────────────────────────
async def get_expiring_soon_users(days: int = 1) -> List[Dict[str, Any]]:
    now = datetime.now()
    future = (now + timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
    now_s = now.strftime("%Y-%m-%d %H:%M:%S")

    if USE_SUPABASE:
        def _sync_soon():
            res = supabase_client.table("users").select("*").eq("is_vip", 1).gt("expiry_date", now_s).lte("expiry_date", future).execute()
            return res.data or []
        return await asyncio.to_thread(_sync_soon)

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM users WHERE is_vip=1 AND expiry_date>? AND expiry_date<=?",
            (now_s, future)
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]


# ── 11. የታገዱ (Expired/Banned) ተጠቃሚዎች ዝርዝር ─────────────────────────────
async def get_banned_users(limit: int = 100) -> List[Dict[str, Any]]:
    if USE_SUPABASE:
        def _sync_banned():
            res = supabase_client.table("users").select("user_id, full_name, expiry_date")\
                .eq("is_vip", 0)\
                .not_.is_("expiry_date", "null")\
                .order("expiry_date", desc=True)\
                .limit(limit).execute()
            return res.data or []
        return await asyncio.to_thread(_sync_banned)

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT user_id, full_name, expiry_date FROM users "
            "WHERE is_vip=0 AND expiry_date IS NOT NULL ORDER BY expiry_date DESC LIMIT ?",
            (limit,)
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]


# ── 12. የሁሉም ተጠቃሚዎች ዝርዝር (ለማሰራጫ / Post Bot) ─────────────────────────
async def get_all_users() -> List[Dict[str, Any]]:
    if USE_SUPABASE:
        def _sync_all():
            res = supabase_client.table("users").select("user_id").execute()
            return res.data or []
        return await asyncio.to_thread(_sync_all)

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT user_id FROM users") as cur:
            return [dict(r) for r in await cur.fetchall()]


# ── 13. ክፍያ በ Transaction ID መፈለግ (Duplicate Check) ────────────────────────
def get_payment_by_tid(transaction_id: str) -> Optional[Dict[str, Any]]:
    """Synchronous lookup used in message handlers."""
    if USE_SUPABASE:
        try:
            res = supabase_client.table("payments").select("*").eq("transaction_id", transaction_id).limit(1).execute()
            if res.data and len(res.data) > 0:
                return res.data[0]
            return None
        except Exception as e:
            logger.error(f"Error checking TID in Supabase: {e}")
            return None

    import sqlite3
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT user_id, amount FROM payments WHERE transaction_id=?", (transaction_id,))
    row = cursor.fetchone()
    conn.close()
    if row:
        return {"user_id": row[0], "amount": row[1]}
    return None


# ── 14. አዲስ ክፍያ መመዝገብ ──────────────────────────────────────────────────
async def add_payment(user_id: int, payer_name: str, phone: str, transaction_id: str, amount: float, bank: Optional[str] = None) -> bool:
    """Inserts a payment. Returns True on success, False if duplicate."""
    if USE_SUPABASE:
        def _sync_insert():
            try:
                res = supabase_client.table("payments").insert({
                    "user_id": user_id,
                    "payer_name": payer_name,
                    "phone": phone,
                    "transaction_id": transaction_id,
                    "amount": float(amount),
                    "bank": bank,
                    "status": "approved"
                }).execute()
                return bool(res.data)
            except Exception as ex:
                logger.warning(f"Supabase payment insert error (likely duplicate): {ex}")
                return False
        return await asyncio.to_thread(_sync_insert)

    async with aiosqlite.connect(DB_PATH) as db:
        try:
            await db.execute(
                "INSERT INTO payments (user_id, payer_name, phone, transaction_id, amount, bank) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (user_id, payer_name, phone, transaction_id, amount, bank),
            )
            await db.commit()
            return True
        except aiosqlite.IntegrityError:
            return False


# ── 15. ሁሉንም ክፍያዎች እና ጠቅላላ ገቢ ማውጣት ────────────────────────────────
async def get_all_payments_and_total() -> Tuple[List[Dict[str, Any]], float]:
    if USE_SUPABASE:
        def _sync_payments():
            res = supabase_client.table("payments").select("*").order("id", desc=False).execute()
            data = res.data or []
            total = sum(float(p.get("amount", 0)) for p in data)
            return data, total
        return await asyncio.to_thread(_sync_payments)

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM payments ORDER BY id ASC") as cur:
            payments = [dict(r) for r in await cur.fetchall()]
        async with db.execute("SELECT COALESCE(SUM(amount), 0) FROM payments") as cur:
            total = float((await cur.fetchone())[0])
        return payments, total
