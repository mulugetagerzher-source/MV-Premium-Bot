import os
from dotenv import load_dotenv

# --- 1. Load secrets from .env (never commit .env to git!) ---
load_dotenv()

# Telegram API Credentials
API_ID = int(os.getenv("API_ID", "0"))
API_HASH = os.getenv("API_HASH", "")

# Bot Token and Username
BOT_TOKEN = os.getenv("BOT_TOKEN", "")
BOT_USERNAME = os.getenv("BOT_USERNAME", "Wonde_vip_bot")

# Admin Information (supports single ID or comma-separated IDs)
_admin_raw = os.getenv("ADMIN_ID", "8614122635")
ADMIN_IDS = [int(x.strip()) for x in _admin_raw.split(",") if x.strip().isdigit()]
ADMIN_ID = ADMIN_IDS[0] if ADMIN_IDS else 8614122635

def is_admin(user_id: int) -> bool:
    return user_id in ADMIN_IDS

# ==========================================================================
# የክፍያ መረጃ (Wonde VIP)
# ==========================================================================
ACCOUNT_NAME = os.getenv("ACCOUNT_NAME", "Wonde Gibo")

CBE_ACCOUNT = os.getenv("CBE_ACCOUNT", "1000306683954")
ABYSSINIA_ACCOUNT = os.getenv("ABYSSINIA_ACCOUNT", "75659105")
TELEBIRR_NUMBER = os.getenv("TELEBIRR_NUMBER", "0931069974")
AWASH_ACCOUNT = os.getenv("AWASH_ACCOUNT", "01320557843000")

# ተጨማሪ መረጃ/ድጋፍ ለማግኘት
SUPPORT_CONTACT = os.getenv("SUPPORT_CONTACT", "@wolde_28")

# Windows ላይ Tesseract-OCR ጫነህ ከሆነ (https://github.com/UB-Mannheim/tesseract/wiki)፣
# ራሱ PATH ውስጥ ካልገባ ሙሉ ፋይል መንገዱን እዚህ አስቀምጥ፣ ለምሳሌ፡
# TESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe
TESSERACT_CMD = os.getenv("TESSERACT_CMD", "")

if not BOT_TOKEN or not API_HASH:
    raise RuntimeError(
        "BOT_TOKEN/API_HASH አልተገኙም! እባክዎ .env ፋይል ይፍጠሩ (.env.example ይመልከቱ)።"
    )

# ⚠️ ትክክለኛውን የ Wonde VIP አድል ሊንክ (t.me/addlist/...) እዚህ ማስገባት አለብህ!
VIP_LINK = os.getenv("VIP_LINK", "https://t.me/addlist/REPLACE_WITH_WONDE_VIP_LINK")

# ==========================================================================
# Wonde VIP ቻናሎች (49 ተረጋግጠው ገብተዋል - forward_sync.py ላይ ካለው ጋር ተመሳሳይ)
# ⚠️ ቀሪዎቹ ካሉ ID ስጠኝ ተጨማሪ አክልላቸዋለሁ
# ==========================================================================
CHANNELS = [
    -1001987304596, -1001879981713, -1001908488600, -1001894307398, -1001886847332, -1001644520879,
    -1001228986551, -1001798057767, -1001785612472, -1001972355742, -1001872327091, -1001942531103,
    -1001672526790, -1001982664935, -1001682250265, -1001841610985, -1001933037611, -1001916522608,
    -1001923315234, -1001672417759, -1001904087061, -1001974239289, -1001978229621, -1001829943930,
    -1001604567537, -1001796161543, -1001977135210, -1001829347343, -1001921674082, -1001846971061,
    -1001960309825, -1001907677718, -1001937713508, -1001962490484, -1001889028743, -1001820656106,
    -1001705942123, -1001802800701, -1001715577856, -1001711316031, -1002114117328, -1001934660701,
    -1002030934045, -1001994830663, -1002097422043, -1001970922921, -1002071141228, -1002441690243,
    -1002234781880,
]

# ==========================================================================
# Subscription Packages (Wonde VIP)
# ==========================================================================
# Package check emoji ID (✔️)
PKG_CHECK_EMOJI_ID = "6053202116707622090"

PACKAGES = {
    "1month": {"label": "1 ወር 300",   "price": 300},
    "2month": {"label": "2 ወር 600",   "price": 600},
    "3month": {"label": "3 ወር 800",   "price": 800},
    "6month": {"label": "6 ወር 1600",  "price": 1600},
    "1year":  {"label": "1 አመት 3000", "price": 3000},
}

# Database configuration
DB_PATH = "mule_vip.db"
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")
