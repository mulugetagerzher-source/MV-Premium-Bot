import asyncio
import html
import logging
import re

from aiogram import Router, F, types
from aiogram.enums import ParseMode
from aiogram.exceptions import TelegramAPIError, TelegramRetryAfter
from aiogram.types import (InputMediaAudio, InputMediaDocument,
                            InputMediaPhoto, InputMediaVideo)

forward_router = Router()

# ==========================================================================
# Wonde VIP channel ID  →  Mule VIP channel ID  (ቀጥታ ጥንድ-በጥንድ ካርታ)
# ==========================================================================
SOURCE_TO_TARGET = {
    -1001987304596: -1002423417645,   # 1  All በየቀኑ የሚወጡ ፊልሞች
    -1001879981713: -1002650607542,   # 2  OLD ENG/AMC በትርጉም
    -1001908488600: -1002169149955,   # 3  ROMANCE
    -1001894307398: -1002508115837,   # 4  Nw + Old HD ተከታታይ
    -1001886847332: -1002319837983,   # 5  አዳዲስ ተከታታይ
    -1001644520879: -1002324941613,   # 6  Karati & China winner
    -1001228986551: -1002669396091,   # 7  School Life
    -1001798057767: -1002626907609,   # 8  አዳዲስ አማርኛ ተከታታይ ድራማ
    -1001785612472: -1002567328978,   # 9  አዳዲስ KANA SERIES
    -1001972355742: -1002522215472,   # 10 ታዋቂ አክተር አሜሪካ
    -1001872327091: -1002657073575,   # 11 Adventure
    -1001942531103: -1002588311600,   # 12 አዳዲስ አማርኛ
    -1001672526790: -1002553134144,   # 13 OLD HIND
    -1001982664935: -1002655302942,   # 14 Sci-Fi, Box, WWE
    -1001682250265: -1002636774331,   # 15 የህንድ ተከታታይ ፊልሞች
    -1001841610985: -1002644195273,   # 16 Software And Game
    -1001933037611: -1002514749751,   # 17 የውጭ ኮሜዲ
    -1001916522608: -1002691430764,   # 18 Album & Old collection Music
    -1001923315234: -1002585618489,   # 19 Protestant መዝሙር
    -1001672417759: -1002643706634,   # 20 ISLAMIC
    -1001904087061: -1002576841957,   # 21 መፅሐፎች እና ትረካ
    -1001974239289: -1002591349745,   # 22 የእስር ቤት HD
    -1001978229621: -1002221689968,   # 23 HINDI SPECIAL
    -1001829943930: -1002390297239,   # 24 OLD SERIES ያለ ትርጉም
    -1001604567537: -1002583933986,   # 25 የኦርቶዶክስ መንፈሳዊ
    -1001796161543: -1002623274378,   # 26 Old English Movies
    -1001977135210: -1002306016272,   # 27 Action movie
    -1001829347343: -1002347487574,   # 28 አዳዲስ HIND ፊልሞች
    -1001921674082: -1002648436217,   # 29 አዳዲስ American & ENG
    -1001846971061: -1002666745363,   # 30 New HD Movies ያለትርጉም
    -1001960309825: -1002529511334,   # 31 ANIMATION
    -1001907677718: -1002582599200,   # 32 NEW MUSIC
    -1001937713508: -1002555200141,   # 33 KOREAN HD ያለትርጉም
    -1001962490484: -1002695070172,   # 34 አዳድስ የቱርክ ተከታታይ
    -1001889028743: -1002690330502,   # 35 የዘረፋ
    -1001820656106: -1002631616644,   # 36 HORROR
    -1001705942123: -1002628123285,   # 37 ፖስተር // Poster & Trailer
    -1001802800701: -1002407817482,   # 38 Wonde Afaan Oromo
    -1001715577856: -1002237864390,   # 39 Old አማረኛ ፊልሞች
    -1001711316031: -1002410671939,   # 40 New ተከታታይ ያለ ትርጉም
    -1002114117328: -1002674164078,   # 41 የአመቱ ምርጥ ፊልሞች
    -1001934660701: -1002520724966,   # 42 የተዘለሉ ፊልሞች
    -1002030934045: -1002655326118,   # 43 Full Episode ቱርክ ተከታታይ
    -1001994830663: -1002577504607,   # 44 Old kana Full Episode
    -1002097422043: -1002598466669,   # 45 Full Episode Korean HD በትርጉም
    -1001970922921: -1002593428706,   # 46 EROTIC
    -1002071141228: -1003943840955,   # 47 ሀበሻ Adult
    -1002441690243: -1003962678780,   # 48 ተከታታይ ፊልሞች Link A_Z
    -1002234781880: -1004362339541,   # 49 All ትርጉም ተከታታይ ፊልሞች
}

# ==========================================================================
# ሊንክ ፎርማት — caption/text ውስጥ ያለ ሊንክ monospace/tap-to-copy እንዲሆን
# ==========================================================================
URL_RE = re.compile(r'(https?://\S+|www\.\S+|t\.me/\S+)')


def maybe_reformat_caption(caption: str):
    """ካፕሽኑ ውስጥ ሊንክ ካለ ብቻ፣ ሊንኩን <code> (tap-to-copy) አድርጎ ይመልሳል።
    ሊንክ ከሌለ (None, None) ይመልሳል፣ ስለዚህ ኦርጅናሉ ፎርማት (ቦልድ/ጣሊክ...) ሳይለወጥ በ copy_message ይጠበቃል።"""
    if not caption or not URL_RE.search(caption):
        return None, None
    escaped = html.escape(caption)
    new_text = URL_RE.sub(lambda m: f"<code>{m.group(0)}</code>", escaped)
    return new_text, ParseMode.HTML


def _has_media(m: types.Message) -> bool:
    return bool(
        m.photo or m.video or m.document or m.audio or
        m.animation or m.voice or m.video_note
    )


def _to_input_media(m: types.Message, caption, parse_mode):
    kwargs = {}
    if caption is not None:
        kwargs["caption"] = caption
        kwargs["parse_mode"] = parse_mode
    if m.photo:
        return InputMediaPhoto(media=m.photo[-1].file_id, **kwargs)
    if m.video:
        return InputMediaVideo(media=m.video.file_id, **kwargs)
    if m.document:
        return InputMediaDocument(media=m.document.file_id, **kwargs)
    if m.audio:
        return InputMediaAudio(media=m.audio.file_id, **kwargs)
    return None


# ==========================================================================
# ወረፋ (queue) + rate-limit/retry worker — ምንም ፋይል እንዳይጠፋ
# ==========================================================================
_queue: "asyncio.Queue" = asyncio.Queue()
_worker_task = None
_MIN_DELAY = 1.5
_MAX_RETRIES = 5


async def _send_single(job):
    bot, src, msg_id, target, caption, parse_mode = (
        job["bot"], job["src"], job["msg_id"], job["target"],
        job["caption"], job["parse_mode"],
    )
    kwargs = {}
    if caption is not None:
        kwargs["caption"] = caption
        kwargs["parse_mode"] = parse_mode
    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            await bot.copy_message(chat_id=target, from_chat_id=src, message_id=msg_id, **kwargs)
            return
        except TelegramRetryAfter as e:
            logging.warning(f"[forward-sync] flood-wait {e.retry_after}s (single {src}->{target} #{msg_id})")
            await asyncio.sleep(e.retry_after + 1)
        except TelegramAPIError as e:
            logging.error(f"[forward-sync] single-copy error {src}->{target} #{msg_id}: {e}")
            return
    logging.error(f"[forward-sync] gave up (single) {src}->{target} #{msg_id}")


async def _send_group(job):
    bot, target, media = job["bot"], job["target"], job["media"]
    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            await bot.send_media_group(chat_id=target, media=media)
            return
        except TelegramRetryAfter as e:
            logging.warning(f"[forward-sync] flood-wait {e.retry_after}s (group -> {target})")
            await asyncio.sleep(e.retry_after + 1)
        except TelegramAPIError as e:
            logging.error(f"[forward-sync] media-group error -> {target}: {e}")
            return
    logging.error(f"[forward-sync] gave up (group) -> {target}")


async def _worker():
    while True:
        job = await _queue.get()
        try:
            if job["type"] == "single":
                await _send_single(job)
            else:
                await _send_group(job)
        finally:
            _queue.task_done()
            await asyncio.sleep(_MIN_DELAY)


def ensure_worker_started():
    global _worker_task
    if _worker_task is None:
        _worker_task = asyncio.create_task(_worker())


# ==========================================================================
# Media group (album) buffering — ፎቶ/ፋይሎች በጉሩፕ ሳይበታተኑ አብረው እንዲላኩ
# ==========================================================================
_group_buffers: dict = {}
_group_timers: dict = {}
_GROUP_WAIT = 1.2  # የ group አባላት ሁሉ እስኪደርሱ የሚጠበቅ ሰከንድ


async def _flush_group(key):
    await asyncio.sleep(_GROUP_WAIT)
    messages = _group_buffers.pop(key, [])
    _group_timers.pop(key, None)
    if not messages:
        return

    messages.sort(key=lambda m: m.message_id)
    target_id = SOURCE_TO_TARGET.get(messages[0].chat.id)
    if not target_id:
        return

    media_list = []
    for m in messages:
        caption, parse_mode = maybe_reformat_caption(m.caption)
        item = _to_input_media(m, caption, parse_mode)
        if item:
            media_list.append(item)

    if not media_list:
        return

    await _queue.put({
        "type": "group",
        "bot": messages[0].bot,
        "target": target_id,
        "media": media_list,
    })


@forward_router.channel_post(F.chat.id.in_(SOURCE_TO_TARGET.keys()))
async def sync_wonde_to_mule(message: types.Message):
    ensure_worker_started()

    target_id = SOURCE_TO_TARGET.get(message.chat.id)
    if not target_id:
        return

    # 2. ፋይል/ፎቶ የሌላቸው ለብቻቸው የተጻፉ text መልእክቶች ፎርዋርድ አይደረጉም
    if not _has_media(message):
        return

    # 1. Media group (album) አባል ከሆነ — ሁሉም እስኪሰበሰቡ ጠብቆ ባንድ ላይ ይላካል (አይበታተንም)
    if message.media_group_id:
        key = (message.chat.id, message.media_group_id)
        _group_buffers.setdefault(key, []).append(message)
        if key in _group_timers:
            _group_timers[key].cancel()
        _group_timers[key] = asyncio.create_task(_flush_group(key))
        return

    # ነጠላ ፋይል/ፎቶ + caption (ካለ) — 3. ካፕሽኑ ውስጥ ሊንክ ካለ ብቻ tap-to-copy ፎርማት ይደረግለታል
    caption, parse_mode = maybe_reformat_caption(message.caption)

    await _queue.put({
        "type": "single",
        "bot": message.bot,
        "src": message.chat.id,
        "msg_id": message.message_id,
        "target": target_id,
        "caption": caption,
        "parse_mode": parse_mode,
    })


# --- Helper: የቻናል ID ማግኛ (ለወደፊት ተጨማሪ ቻናል ስታክል የሚጠቅም) ---
@forward_router.message(F.forward_from_chat)
async def get_forwarded_channel_id(message: types.Message):
    import config
    if not config.is_admin(message.from_user.id):
        return
    chat = message.forward_from_chat
    await message.answer(
        f"📌 <b>{chat.title}</b>\nID: <code>{chat.id}</code>",
        parse_mode="HTML"
    )
