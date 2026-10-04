"""
የክፍያ ደረሰኝ ማረጋገጫ — CBE, Telebirr, Awash, Abyssinia (BOA)

CBE: ⚠️ ሙሉ በሙሉ ተቀይሯል (paste-to-verify / awet_online_equib cbe-verifier አካሄድ) —
apps.cbe.com.et:100 ላይ ተመስርቶ ራሱ URL የመገንባት አካሄድ ሙሉ በሙሉ ተነስቷል (ያ endpoint ደግሞ
ቆሟል)። አሁን CBE's ራሱ mbreciept.cbe.com.et (ወይም ሌላ *.cbe.com.et) ደረሰኝ ሊንክ ብቻ ነው
የሚታመነው፤ ይሄ ሊንክ ገፅ SPA ስለሆነ Playwright headless browser ተጠቅመን ራንደር አድርገን፣
የገፁን ጽሁፍ (Payer/Receiver/Account/Transferred Amount/Reference No...) በቅደም ተከተል
እናነባለን። ደረሰኙ/ጽሁፍ/screenshot ላይ ያለው amount/ስም በቀጥታ አይታመንም (በቀላሉ ሊፈብረክ ስለሚችል) —
ሁልጊዜ CBE's ራሱ ገፅ ላይ ተመስርተን ብቻ ነው የምናረጋግጠው (fail-closed)።

Telebirr/Awash/BOA: ነባሩ (transactioninfo.ethiotelecom.et / awashpay / cs.bankofabyssinia)
webscrape-based ማረጋገጫ እንደተጠበቀ ሆኖ፣ የአካውንት/ስልክ ንፅፅሩ ማስክ (****) ያለበትን
ቁጥር በትክክል እንዲይዝ ተስተካክሏል (ከዚህ በፊት የተስተካከለ)።
"""
import asyncio
import logging
import os
import re
import tempfile
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

import requests

import config
from ethiobank_receipts.extractors.awash import extract_awash_receipt_data
from ethiobank_receipts.extractors.boa import extract_boa_receipt_data
from ethiobank_receipts.extractors.tele import extract_tele_receipt_data

logger = logging.getLogger(__name__)


# ==========================================================================
# ረዳት (helper) ፈንክሽኖች
# ==========================================================================
def _to_amount(value):
    """'1,250.75 ETB' የመሳሰለ ጽሁፍን ወደ float ይቀይራል።"""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    cleaned = re.sub(r"[^\d.]", "", str(value))
    try:
        return float(cleaned) if cleaned else None
    except ValueError:
        return None


def _name_matches(actual_name, expected_name) -> bool:
    """የደረሰኙ ስም ከ config ስም ጋር (ፊደላት ብቻ፣ ትልቅ/ትንሽ ሳይለይ) ይመሳሰል እንደሆነ ያረጋግጣል።
    ኮማ (comma) በመጠቀም ከአንድ በላይ ስሞችን ይደግፋል።"""
    if not actual_name or not expected_name:
        return False
    a_clean = re.sub(r"[^a-zA-Z]", "", actual_name).lower()
    if not a_clean:
        return False

    expected_list = [x.strip() for x in str(expected_name).split(",") if x.strip()]
    for exp in expected_list:
        e_clean = re.sub(r"[^a-zA-Z]", "", exp).lower()
        if e_clean and (e_clean in a_clean or a_clean in e_clean):
            return True
        # Also check word token overlap (e.g. "Wonde Gibo" in "Wonde Gibo Ado")
        a_words = [w.lower() for w in actual_name.split() if len(w) >= 3]
        e_words = [w.lower() for w in exp.split() if len(w) >= 3]
        common = set(a_words).intersection(set(e_words))
        if len(common) >= 2 or (len(e_words) == 1 and len(common) == 1):
            return True

    return False


def _account_suffix_matches(actual_account, expected_account, digits: int = 6) -> bool:
    """የመጨረሻዎቹ N ዲጂቶች ተመሳሳይ ናቸው እንደሆነ ያረጋግጣል (ደረሰኙ ላይ ብዙ ጊዜ *** ስለሚደበቅ)።

    ማሳሰቢያ: ሁሉንም ዲጂቶች stripe አድርጎ ማገናኘት የለበትም (ለምሳሌ '1000****3954' ላይ * ካስወገድን
    '10003954' ብለን እናገኝና የስህተት ንፅፅር እናደርጋለን)። ይልቁንም ከመጨረሻው የማይቋረጡትን
    (contiguous) ዲጂቶች ብቻ መውሰድ አለብን - ማስኪንግ ከጀመረበት ቦታ ላይ ቆም ብለን።
    """
    if not actual_account or not expected_account:
        return False
    m = re.search(r"(\d+)$", str(actual_account).strip())
    a_digits = m.group(1) if m else ""
    e_digits = re.sub(r"\D", "", str(expected_account))
    if not a_digits or not e_digits:
        return False
    n = min(digits, len(a_digits), len(e_digits))
    return a_digits[-n:] == e_digits[-n:]


# ==========================================================================
# 1. CBE — ⚠️ ሙሉ በሙሉ አዲስ አካሄድ (paste-to-verify / awet_online_equib cbe-verifier)
#
#    apps.cbe.com.et:100 ላይ ተመስርቶ ራሱ URL የመገንባት አካሄድ ሙሉ በሙሉ ተነስቷል — ያ
#    endpoint ራሱ ስለዘጋ ብቻ ሳይሆን፣ CBE ጭራሽ ባዶ TID (ለምሳሌ "FT2513001V2G") ብቻ
#    ተሰጥቶ ደረሰኝ URL የመክፈት መንገድ ስለሌለው ነው። ስለዚህ ገንዘብ ነክ ማረጋገጫው ሁልጊዜ
#    ተጠቃሚው ከላከው ጽሁፍ/QR/screenshot ውስጥ የተገኘ **እውነተኛ CBE ደረሰኝ ሊንክ**
#    (mbreciept.cbe.com.et/... ወይም ሌላ *.cbe.com.et ሊንክ) ይፈልጋል — ልክ ልክ ደረሰኙን
#    ራሱ ራንደር (headless browser) አድርገን ካላነበብነው በስተቀር ምንም አንታመንም።
#
#    ግብዓት (input) ሶስት አይነት ሊሆን ይችላል፡
#      1. ሙሉ የ CBE ማረጋገጫ SMS ጽሁፍ (ሊንኩን ጨምሮ) — ኮፒ-ፔስት ሲደረግ
#      2. ደረሰኙ screenshot (የላከው "Thank you" ገጽ ዓይነት) — QR code ካለበት
#         ቀድሞ ይነበባል (በጣም አስተማማኝ)፣ ካልተሳካ OCR fallback ይሞክራል
#      3. PDF ደረሰኝ ፋይል
#
#    ⚠️ በስክሪንሾቱ/OCR ላይ የሚታየው amount/ስም/ቀን በፍጹም በቀጥታ አይታመንም (ፎቶ በቀላሉ
#    ሊስተካከል ስለሚችል) — እነዚህ ላይ የምንመረኮዘው ደረሰኙን ራሱ (CBE's server) ለማግኘት
#    (QR/OCR ላይ ያለውን ሊንክ ለማውጣት) ብቻ ነው። ገንዘብ ነክ ውሳኔው ሙሉ ለሙሉ የሚመሰረተው
#    Playwright ራንደር ካደረገው ኦፊሴላዊ CBE ገጽ ላይ ብቻ ነው (fail-closed)።
# ==========================================================================

CBE_HOST = "cbe.com.et"

# CBE's SPA ገጽ በተለይ በደካማ ኢንተርኔት/ሸርድ ሆስቲንግ ላይ ትንሽ ሊዘገይ ስለሚችል ነባሪውን
# generous እናደርገዋለን፤ ካስፈለገ .env ውስጥ CBE_RENDER_TIMEOUT_MS ማስቀመጥ ይቻላል።
CBE_RENDER_TIMEOUT_MS = int(os.getenv("CBE_RENDER_TIMEOUT_MS", "30000"))

READY_TEXT = "Transferred Amount"

_GENERIC_URL_RE = re.compile(r"https?://[^\s<>()\"']+", re.IGNORECASE)
_TRAILING_PUNCT_RE = re.compile(r"[.,;:!?)\]}'\"]+$")


class ReceiptFetchError(Exception):
    """ገጹ ጭራሽ ማንበብ/ራንደር ማድረግ አልተቻለም (ኔትወርክ፣ timeout፣ browser ችግር)።"""


class ReceiptParseError(Exception):
    """ገጹ ተከፈተ ግን የምንፈልጋቸው መስኮች አልተገኙም — ብዙ ጊዜ ትርጉሙ ሊንኩ/TID ልክ
    አይደለም ወይም ትራንዛክሽኑ የለም ማለት ነው።"""


def _find_tid_in_text(text: str) -> str | None:
    """FT+10-character TID ን በጽሁፍ ውስጥ ፈልጎ ያገኛል (OCR አንዳንዴ 'FT26185 GYMQS'
    እንደሚያደርገው መሃል ስፔስ/አዲስ-መስመር ቢያስገባም ያገኛል)። ማሳሰቢያ፡ ይሄ ብቻውን ደረሰኝ URL
    ለመገንባት ስለማይችል፣ ለ display/reservation key ብቻ ይጠቅማል።"""
    if not text:
        return None
    m = re.search(r"\b(FT[A-Z0-9]{10})\b", text, re.IGNORECASE)
    if m:
        return m.group(1).upper()
    for m in re.finditer(r"FT[\sA-Z0-9]{8,16}", text, re.IGNORECASE):
        candidate = re.sub(r"\s+", "", m.group(0)).upper()
        if re.fullmatch(r"FT[A-Z0-9]{10}", candidate):
            return candidate
    return None


def _find_cbe_url_in_text(text: str) -> str | None:
    """ተጠቃሚው የላከው ጽሁፍ/QR/OCR ውስጥ ትክክለኛ *.cbe.com.et ሊንክ ፈልጎ ይመልሳል።
    dot-boundary host ንፅፅር ስለሚጠቀም 'evil.example/cbe.com.et' አይነት ማጭበርበር
    አይሠራም (urlparse().hostname ራሱ ብቻ ነው የሚታይ)።"""
    if not text:
        return None
    for m in _GENERIC_URL_RE.finditer(text):
        candidate = _TRAILING_PUNCT_RE.sub("", m.group(0))
        try:
            host = (urlparse(candidate).hostname or "").lower()
        except ValueError:
            continue
        if host == CBE_HOST or host.endswith("." + CBE_HOST):
            return candidate
    return None


def extract_cbe_tid(user_input: str) -> str | None:
    """ተጠቃሚው ከላከው ጽሁፍ (SMS/paste/QR content) ውስጥ የምናገኘውን ጠቃሚ ነገር ይመልሳል፦
      1. ባዶ TID (FT + 10 ቁምፊዎች) ቢገኝ → ያንኑ ይመልሳል (ጊዜያዊ display/dedup key
         ብቻ - ገንዘብ ነክ ማረጋገጫ በዚህ ብቻ አይደረግም)።
      2. TID ባይገኝም እውነተኛ CBE ደረሰኝ ሊንክ (mbreciept.cbe.com.et ወይም ሌላ
         *.cbe.com.et ሊንክ) ቢገኝ → ያንን ሊንክ ራሱ ይመልሳል (verify_cbe_payment()
         ውስጥ ለ render ጥቅም ላይ ይውላል)።
      3. ምንም ካልተገኘ → None (ራስ-ሰር ማረጋገጥ አይቻልም ማለት ነው)።
    """
    s = (user_input or "").strip()
    if not s:
        return None
    tid = _find_tid_in_text(s)
    if tid:
        return tid
    return _find_cbe_url_in_text(s)


def extract_cbe_tid_from_image(image_bytes: bytes) -> str | None:
    """ተጠቃሚ የላከውን ስክሪንሾት (ለምሳሌ CBE መተግበሪያው 'Thank you' ገጽ) ተቀብለን ጠቃሚውን
    ነገር እናወጣለን፦ 1) QR code (ካለ - በጣም አስተማማኝ፣ ብዙ ጊዜ ሙሉ ደረሰኝ ሊንኩን ይይዛል)
    2) OCR fallback (TID ወይም ሊንክ ጽሁፍ ላይ ቢታይ)።"""
    try:
        from utils.qr_decode import decode_qr_from_bytes
        qr_text = decode_qr_from_bytes(image_bytes)
        if qr_text:
            logger.info(f"receipt QR decoded content: {qr_text[:200]!r}")
            found = extract_cbe_tid(qr_text)
            if found:
                return found
        else:
            logger.info("receipt image: QR code አልተገኘም")
    except Exception as e:
        logger.warning(f"receipt image QR decode failed: {e}")

    try:
        import pytesseract
        from PIL import Image, ImageOps, ImageEnhance
        from io import BytesIO

        if getattr(config, "TESSERACT_CMD", None):
            pytesseract.pytesseract.tesseract_cmd = config.TESSERACT_CMD

        img = Image.open(BytesIO(image_bytes)).convert("RGB")
        gray = ImageOps.grayscale(img)
        gray = gray.resize((gray.width * 2, gray.height * 2), Image.LANCZOS)
        gray = ImageEnhance.Contrast(gray).enhance(1.8)
        gray = ImageEnhance.Sharpness(gray).enhance(2.0)

        for variant, cfg in ((gray, "--psm 6"), (img, "--psm 11")):
            text = pytesseract.image_to_string(variant, config=cfg)
            found = _find_tid_in_text(text)
            if found:
                return found
            found = _find_cbe_url_in_text(text)
            if found:
                return found
    except Exception as e:
        logger.warning(f"receipt image OCR failed: {e}")

    return None


def extract_cbe_tid_from_pdf(pdf_bytes: bytes) -> str | None:
    """ተጠቃሚ የላከውን PDF ደረሰኝ ተቀብለን ውስጡ ያለውን TID ወይም CBE ሊንክ እናወጣለን።"""
    try:
        import pdfplumber
    except ImportError:
        logger.warning("pdfplumber አልተጫነም")
        return None

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
    tmp.write(pdf_bytes)
    tmp.close()
    try:
        with pdfplumber.open(tmp.name) as pdf:
            full = "\n".join((p.extract_text() or "") for p in pdf.pages)
        tid = _find_tid_in_text(full)
        if tid:
            return tid
        return _find_cbe_url_in_text(full)
    except Exception as e:
        logger.warning(f"extract_cbe_tid_from_pdf failed: {e}")
        return None
    finally:
        try:
            os.unlink(tmp.name)
        except Exception:
            pass


# ── Playwright-rendered receipt fetch (PDF-download አካሄዱን ተክቷል) ─────
#
# CBE's mbreciept.cbe.com.et ገጽ JS SPA ነው (ቀጥታ HTTP GET ማድረግ ባዶ loading
# spinner ብቻ ይመልሳል) — ስለዚህ headless browser (Playwright) ተጠቅመን እውነተኛውን
# DOM እናነባለን፤ ሁሉንም የጽሁፍ node በ document ቅደም ተከተል እንሰበስብና እያንዳንዱ label
# («Payer»፣ «Receiver»፣ «Account»፣ «Transferred Amount»፣ «Reference No»...)
# ተከትሎ ያለውን ዋጋ እናነባለን (ልክ እንደ paste-to-verify's providers/cbe.ts)።

_SKIP_TAGS = {"script", "style", "title", "noscript", "template"}


def _normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _value_after(segments: list[str], label: str, start: int = 0):
    """ከ `label` ጋር ተመሳሳይ የሚጀምረውን የመጀመሪያ segment ተከትሎ ያለውን ዋጋ ይመልሳል።"""
    want = label.lower()
    for i in range(start, len(segments)):
        if segments[i].lower().startswith(want):
            value = segments[i + 1] if i + 1 < len(segments) else None
            return value, i
    return None, -1


def _account_after(segments: list[str], party_index: int):
    """የ party label (Payer/Receiver) ተከትሎ ያለውን የመጀመሪያ 'Account' ዋጋ ይመልሳል —
    party_index < 0 ከሆነ (ራሱ label ካልተገኘ) None ይመልሳል፣ ስለዚህ ብቸኛ 'Account'
    segment ለተሳሳተ ወገን አይሰጥም።"""
    if party_index < 0:
        return None
    value, _ = _value_after(segments, "Account", party_index + 1)
    return value


async def _render_and_collect_segments(url: str, timeout_ms: int) -> list[str]:
    """CBE's SPA ደረሰኝ headless browser ተጠቅመን ራንደር እናደርግና በ document ቅደም
    ተከተል ያለውን ጽሁፍ (text node) ሁሉ እንሰበስባለን።"""
    try:
        from playwright.async_api import async_playwright
    except ImportError as e:
        raise RuntimeError(
            "playwright አልተጫነም። ያስፈልጋል፡ pip install playwright && playwright install chromium"
        ) from e

    collect_js = """
    () => {
      const SKIP_TAGS = new Set(['script', 'style', 'title', 'noscript', 'template']);
      const segments = [];
      const normalize = (s) => s.replace(/\\s+/g, ' ').trim();
      const visit = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const t = normalize(node.textContent || '');
          if (t) segments.push(t);
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const tag = (node.tagName || '').toLowerCase();
        if (SKIP_TAGS.has(tag)) return;
        for (const child of node.childNodes) visit(child);
      };
      visit(document.body);
      return segments;
    }
    """

    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True)
            try:
                page = await browser.new_page()
                await page.goto(url, wait_until="networkidle", timeout=timeout_ms)
                await page.get_by_text(READY_TEXT, exact=False).first.wait_for(timeout=timeout_ms)
                return await page.evaluate(collect_js)
            finally:
                await browser.close()
    except RuntimeError:
        raise
    except Exception as exc:
        raise ReceiptFetchError(f"CBE ደረሰኝ ገጽ ማንበብ አልተቻለም: {exc}") from exc


async def _fetch_and_parse_cbe(url: str, timeout_ms: int) -> dict:
    segments = await _render_and_collect_segments(url, timeout_ms=timeout_ms)
    segments = [_normalize_whitespace(s) for s in segments if _normalize_whitespace(s)]

    amount_text, _ = _value_after(segments, "Transferred Amount")

    reference, _ = _value_after(segments, "Reference No")
    if not reference:
        reference, _ = _value_after(segments, "VAT Receipt No")

    payer_name, payer_idx = _value_after(segments, "Payer")
    receiver_name, receiver_idx = _value_after(segments, "Receiver")

    if not reference or amount_text is None:
        raise ReceiptParseError(
            "CBE ደረሰኝ ላይ የሚያስፈልጉ መስኮች (reference/amount) አልተገኙም — ገጹ ገና ሙሉ "
            "ላይጫን ችሏል፣ ወይም ሊንኩ/TID ልክ አይደለም።"
        )

    payer_account = _account_after(segments, payer_idx)
    receiver_account = _account_after(segments, receiver_idx)

    return {
        "reference": (reference or "").strip(),
        "amount": _to_amount(amount_text) or 0.0,
        "payer_name": (payer_name or "").strip(),
        "payer_account": (payer_account or "").strip(),
        "receiver_name": (receiver_name or "").strip(),
        "receiver_account": (receiver_account or "").strip(),
        # ሙሉ ራንደር የተደረገ ጽሁፍ — ለ debug/log ብቻ፣ ውሳኔ ላይ ጥቅም ላይ አይውልም (ከዚህ
        # በታች ባለው verify_cbe_payment() ውስጥ ለምን እንደሆነ ይመልከቱ)።
        "_raw_text": " ".join(segments),
    }


async def verify_cbe_payment(user_input: str, expected_amount: float):
    """CBE ደረሰኝ ያረጋግጣል — Playwright headless browser ተጠቅሞ ተጠቃሚው ከላከው
    ጽሁፍ/QR/screenshot ውስጥ የተገኘውን **እውነተኛ** CBE ደረሰኝ ሊንክ ራንደር አድርጎ ያነባል
    (ራሳችን URL አንገነባም - CBE ከ TID ብቻ ደረሰኝ የሚከፈትበት መንገድ የለውም)።

    Returns: (ok, message, actual_amount, payer_name, payer_account, reference)

    `reference` ደረሰኙ ራሱ (CBE's rendered page) ላይ ያለው Reference No./VAT
    Receipt No. ነው (ok=True ሲሆን ብቻ ይሞላል) — ይሄ ብቻ ነው ለ payments ቴብል
    (transaction_id) መመዝገብ ያለበት፣ ተጠቃሚው የላከው ጽሁፍ/ሊንክ ራሱ ብቻ ቢሆን ትንሽ
    በተለያየ መልኩ ተጽፎ ተመሳሳይ እውነተኛ ትራንዛክሽን ሁለት ጊዜ ጥቅም ላይ እንዳይውል ይከላከላል
    (handlers/user_handlers/payment_id.py ይመልከቱ)።
    """
    acct_digits = re.sub(r"\D", "", config.CBE_ACCOUNT)
    if len(acct_digits) < 8:
        return False, "❌ CBE account config ስህተት (< 8 digits)", None, None, None, None
    our_last4 = acct_digits[-4:]

    # ── እውነተኛ CBE ደረሰኝ ሊንክ ፈልግ (ራሳችን አንገነባም) ──
    url = _find_cbe_url_in_text(user_input)
    if not url:
        tid_guess = _find_tid_in_text(user_input)
        hint = f"💳 TID {tid_guess} አግኝቻለሁ፣ " if tid_guess else ""
        return False, (
            f"❌ ሙሉ ደረሰኝ ያስፈልጋል\n\n{hint}ግን CBE ባዶ TID ብቻ ተሰጥቶ ደረሰኝ የሚከፈትበት "
            "መንገድ ስለሌለው በዚህ ብቻ ማረጋገጥ አልችልም።\n\n"
            "እባክዎ ከሚከተሉት አንዱን ይላኩ፦\n"
            "• ሙሉ የCBE ማረጋገጫ SMS ጽሁፍ (ሊንኩን ጨምሮ፣ ኮፒ-ፔስት)፣ ወይም\n"
            "• የደረሰኙን screenshot (QR ኮድ ግልጽ ሆኖ የሚታይበት)"
        ), None, None, None, None

    try:
        data = await _fetch_and_parse_cbe(url, timeout_ms=CBE_RENDER_TIMEOUT_MS)
    except ReceiptParseError:
        return False, (
            f"❌ Transaction Not Found — ደረሰኙ ላይ የሚያስፈልጉ መረጃዎች አልተገኙም። "
            "ሊንኩን አረጋግጠው ደግመው ይሞክሩ።"
        ), None, None, None, None
    except ReceiptFetchError as e:
        logger.warning(f"CBE fetch error url={url}: {e}")
        return False, "❌ ደረሰኙን ማምጣት አልተቻለም። ኢንተርኔት ወይም CBE ገጽ ችግር ሊሆን ይችላል፣ ደግመው ይሞክሩ።", None, None, None, None
    except RuntimeError as e:
        logger.error(f"CBE verify system error: {e}")
        return False, f"⚙️ ስርዓት ስህተት: {e}", None, None, None, None
    except Exception as e:
        logger.error(f"CBE verify unexpected error url={url}: {e}")
        return False, "❌ ማረጋገጫ ስህተት። ደግመው ይሞክሩ።", None, None, None, None

    logger.info(f"CBE receipt parsed: {data}")

    reference = data.get("reference") or None
    payer_name = data.get("payer_name") or ""
    payer_acct = data.get("payer_account") or ""
    actual = float(data.get("amount") or 0)

    # ── የተቀባይ አካውንት ማረጋገጫ (fail-closed) ──
    # CBE ብዙ ጊዜ ይህን መስክ እስከ መጨረሻዎቹ 4 ዲጂት ብቻ ነው የሚያሳየው (ለምሳሌ
    # "1000****3954")፣ ስለዚህ last-4 ንፅፅር ብቻ ነው ይህ ነጠላ መስክ ማረጋገጥ የሚችለው።
    #   1. መስኩ ካለና ከኛ last-4 ጋር ከተመሳሰለ → ያልፋል።
    #   2. መስኩ ካለ ግን ካልተመሳሰለ → በእርግጠኝነት ውድቅ (እውነተኛ የተለየ አካውንት ማለት ነው)።
    #   3. መስኩ ጨርሶ ካልተነበበ → ሁልጊዜ ወደ admin manual review (⚠️ ከዚህ በፊት
    #      በነበረው apps.cbe.com.et:100 አካሄድ ላይ "የኛ last-8 ዲጂት ገጹ ውስጥ የትም
    #      ቦታ ይገኛል" የሚለው fallback ይሰራ ነበር ምክንያቱም URL-ን ራሳችን ስለምንገነባው
    #      ብቻ ነው - አሁን ግን ሊንኩ የመጣው ከከፋዩ SMS/QR ስለሆነ ያ ምክንያት ትርጉም
    #      የለውም፣ ስለዚህ ይህ fallback ሙሉ ለሙሉ ተነስቷል)።
    recv_digits = re.sub(r"\D", "", data.get("receiver_account") or "")

    if recv_digits and not recv_digits.endswith(our_last4):
        return False, (
            f"❌ ክፍያ ወደ ሌላ ሒሳብ ተልኳል (ያስተላለፉት ለ: {data.get('receiver_account') or '?'})"
        ), None, payer_name or None, payer_acct or None, reference

    if not recv_digits:
        return False, (
            f"⚠️ ራስ-ሰር ማረጋገጫ አልተሳካም (TID: {reference or '?'}) - የተቀባይ አካውንት ከደረሰኙ ላይ "
            "ማንበብ አልተቻለም። እባክዎ Admin እስኪያረጋግጥልዎት ይጠብቁ ወይም ደረሰኙን/ሊንኩን ለ Admin "
            "በቀጥታ ይላኩ።"
        ), actual, payer_name or None, payer_acct or None, reference

    if actual < expected_amount or actual > expected_amount + 10:
        return False, (
            f"❌ የከፈሉት {actual:.0f} ብር ከሚጠበቀው {expected_amount:.0f} ብር ጋር አይዛመድም።\n"
            f"እባክዎ {expected_amount:.0f} ብር ብቻ ይክፈሉ።"
        ), actual, payer_name or None, payer_acct or None, reference

    if not reference:
        # amount/receiver ትክክል ቢሆኑም Reference No. ራሱ ካልተነበበ ledger ውስጥ
        # ልንመዘግብበት የምንችል ትክክለኛ TID ስለሌለን (duplicate-use ማወቂያ ይጠፋልና)
        # ራስ-ሰር ማጠናቀቅ አደገኛ ነው - ወደ admin manual review እንልካለን።
        return False, (
            "⚠️ ራስ-ሰር ማረጋገጫ አልተሳካም - የደረሰኝ ቁጥር (Reference No.) ከገጹ ላይ ማንበብ አልተቻለም። "
            "እባክዎ Admin እስኪያረጋግጥልዎት ይጠብቁ ወይም ደረሰኙን ለ Admin በቀጥታ ይላኩ።"
        ), actual, payer_name or None, payer_acct or None, None

    return True, "✅ ክፍያው ተረጋግጧል", actual, payer_name or None, payer_acct or None, reference



# ==========================================================================
# 2. Telebirr — transactioninfo.ethiotelecom.et ኦፊሴላዊ ደረሰኝ ገጽ
# ==========================================================================
def verify_payment(user_input: str, expected_amount: float):
    receipt_id_match = re.search(r"[A-Za-z0-9]{8,}", user_input or "")
    receipt_id = receipt_id_match.group(0) if receipt_id_match else (user_input or "").strip()

    try:
        data = extract_tele_receipt_data(receipt_id)
    except Exception as e:
        logging.error(f"[Telebirr] extraction error: {e}")
        return False, "❌ ደረሰኙን ማንበብ አልተቻለም። ትራንዛክሽን ቁጥሩን በትክክል ያስገቡ።", None, None, None

    status = (data.get("status") or "").lower()
    credited_party = data.get("credited_party") or ""
    credited_number = data.get("credited_party_number") or ""
    amount = _to_amount(data.get("total_paid"))
    payer_name = data.get("payer_name")
    payer_number = data.get("payer_number")

    if status and not any(k in status for k in ("complete", "success")):
        return False, "❌ ክፍያው ገና አልተጠናቀቀም (Pending/Failed)።", amount, payer_name, payer_number
    if not _name_matches(credited_party, config.ACCOUNT_NAME):
        return False, "❌ ገንዘቡ ወደ ትክክለኛው ቴሌብር ቁጥር አልተላከም።", amount, payer_name, payer_number
    if not _account_suffix_matches(credited_number, config.TELEBIRR_NUMBER, digits=4):
        return False, "❌ የተቀባይ ስልክ ቁጥር አይመሳሰልም።", amount, payer_name, payer_number
    # Exact amount check — ±10 ብር tolerance
    if amount is None or amount < expected_amount or amount > expected_amount + 10:
        return False, (
            f"❌ የከፈሉት {amount:.0f} ብር ከሚጠበቀው {expected_amount:.0f} ብር ጋር አይዛመድም።\n"
            f"እባክዎ {expected_amount:.0f} ብር ብቻ ይክፈሉ።"
        ), amount, payer_name, payer_number

    return True, "✅ ክፍያው ተረጋግጧል", amount, payer_name, payer_number


# ==========================================================================
# 3. Awash Bank — ደረሰኙ URL (awashpay.awashbank.com) ያስፈልገዋል
# ==========================================================================
def verify_awash_payment(url: str, expected_amount: float):
    url = (url or "").strip()
    if not url.startswith("http"):
        return False, "❌ እባክዎ ትክክለኛውን የ Awash ደረሰኝ ሙሉ ሊንክ (URL) ይላኩ።", None, None, None

    try:
        data = extract_awash_receipt_data(url)
    except Exception as e:
        logging.error(f"[Awash] extraction error: {e}")
        return False, "❌ ደረሰኙን ማንበብ አልተቻለም። ሊንኩን በትክክል ያስገቡ።", None, None, None

    beneficiary_name = data.get("Beneficiary name") or ""
    beneficiary_account = data.get("Beneficiary Account") or ""
    amount = _to_amount(data.get("Amount"))
    payer_name = data.get("Sender Name")

    logger.info(f"[Awash] scraped data for {url}: {data}")

    if not any(data.values()):
        # ገጹ ምንም ውሂብ አልመለሰም (parse ስህተት እንጂ እውነተኛ የተሳሳተ አካውንት አይደለም) - በግልፅ
        # እንለይ፣ ተጠቃሚው ላይ የተሳሳተ ጥርጣሬ እንዳናሳድር።
        return False, (
            "⚠️ ደረሰኙን ከAwash ገጽ ላይ ማንበብ አልተቻለም (ባዶ ውጤት ተመልሷል)። ሊንኩ ትክክል መሆኑን "
            "ያረጋግጡ ወይም Admin ያናግሩ።"
        ), None, None, None

    if not _name_matches(beneficiary_name, config.ACCOUNT_NAME):
        return False, "❌ ገንዘቡ ወደ ትክክለኛው Awash አካውንት አልተላከም።", amount, payer_name, None
    if not _account_suffix_matches(beneficiary_account, config.AWASH_ACCOUNT):
        return False, "❌ የተቀባይ አካውንት ቁጥር አይመሳሰልም።", amount, payer_name, None
    # Exact amount check — ±10 ብር tolerance
    if amount is None or amount < expected_amount or amount > expected_amount + 10:
        return False, (
            f"❌ የከፈሉት {amount:.0f} ብር ከሚጠበቀው {expected_amount:.0f} ብር ጋር አይዛመድም።\n"
            f"እባክዎ {expected_amount:.0f} ብር ብቻ ይክፈሉ።"
        ), amount, payer_name, None

    return True, "✅ ክፍያው ተረጋግጧል", amount, payer_name, None


# ==========================================================================
# 4. Bank of Abyssinia (BOA) — ደረሰኙ URL (cs.bankofabyssinia.com) ያስፈልገዋል
#    ማሳሰቢያ: Selenium + Chrome/Chromium በሰርቨሩ ላይ መገጠም ይፈልጋል!
# ==========================================================================
def verify_boa_payment(url: str, expected_amount: float):
    url = (url or "").strip()
    if not url.startswith("http"):
        return False, "❌ እባክዎ ትክክለኛውን የ Abyssinia ደረሰኝ ሙሉ ሊንክ (URL) ይላኩ።", None, None, None

    try:
        data = extract_boa_receipt_data(url)
    except Exception as e:
        logging.error(f"[BOA] extraction error: {e}")
        return False, "❌ ደረሰኙን ማንበብ አልተቻለም (WebDriver ችግር ሊሆን ይችላል)። እባክዎ ደግመው ይሞክሩ ወይም አድሚን ያናግሩ።", None, None, None

    receiver_name = data.get("Receiver's Name") or ""
    receiver_account = data.get("Receiver's Account") or ""
    amount = _to_amount(data.get("Transferred Amount"))
    payer_name = data.get("Source Account Name")

    logger.info(f"[BOA] scraped data for {url}: {data}")

    if not any(data.values()):
        # ገጹ ምንም ውሂብ አልመለሰም - ብዙ ጊዜ ገጹ ገና ሙሉ በሙሉ ሳይጫን Selenium ገጹን ስላነበበ
        # (SPA loading ገና ሳያልቅ) ነው - እውነተኛ የተሳሳተ አካውንት አይደለም።
        return False, (
            "⚠️ ደረሰኙን ከAbyssinia ገጽ ላይ ማንበብ አልተቻለም (ባዶ ውጤት ተመልሷል)። ሊንኩ ትክክል መሆኑን "
            "ያረጋግጡ፣ ወይም ትንሽ ቆይተው ደግመው ይሞክሩ፣ አለበለዚያ Admin ያናግሩ።"
        ), None, None, None

    if not _name_matches(receiver_name, config.ACCOUNT_NAME):
        return False, "❌ ገንዘቡ ወደ ትክክለኛው Abyssinia አካውንት አልተላከም።", amount, payer_name, None
    if not _account_suffix_matches(receiver_account, config.ABYSSINIA_ACCOUNT):
        return False, "❌ የተቀባይ አካውንት ቁጥር አይመሳሰልም።", amount, payer_name, None
    # Exact amount check — ±10 ብር tolerance
    if amount is None or amount < expected_amount or amount > expected_amount + 10:
        return False, (
            f"❌ የከፈሉት {amount:.0f} ብር ከሚጠበቀው {expected_amount:.0f} ብር ጋር አይዛመድም።\n"
            f"እባክዎ {expected_amount:.0f} ብር ብቻ ይክፈሉ።"
        ), amount, payer_name, None

    return True, "✅ ክፍያው ተረጋግጧል", amount, payer_name, None


# ለ payment_id.py ቀላል dispatch እንዲሆን
VERIFIERS = {
    "cbe": verify_cbe_payment,
    "telebirr": verify_payment,
    "awash": verify_awash_payment,
    "boa": verify_boa_payment,
}
