import asyncio
import logging
from database import get_expired_users, get_expiring_soon_users, deactivate_user
from utils.emoji import e
import config

logger = logging.getLogger(__name__)

# ጊዜያቸው ሊያልቅ "ነገ ያልቃል" ማስጠንቀቂያ የደረሳቸው ተጠቃሚዎች — ሁለቴ እንዳይደርሳቸው
_notified_expiring: set = set()


async def start_expiry_checker(bot):
    consecutive_errors = 0
    while True:
        try:
            # ── ጊዜ ያለቀባቸው ተጠቃሚዎች ──────────────────────────────────────
            for user in await get_expired_users():
                uid = user["user_id"]
                await deactivate_user(uid)
                # ጊዜ ሲያልቅ ካሳወቅናቸው notification list ውስጥ አስወጣ
                _notified_expiring.discard(uid)
                # Kick expired user from all VIP channels
                for chat_id in config.CHANNELS:
                    try:
                        await bot.ban_chat_member(chat_id=chat_id, user_id=uid)
                        await bot.unban_chat_member(chat_id=chat_id, user_id=uid)
                    except Exception as ex:
                        logger.debug(f"Could not remove expired user {uid} from {chat_id}: {ex}")
                try:
                    await bot.send_message(
                        uid,
                        f"{e('warning')} <b>የቪአይፒ ጊዜዎ አብቅቷል!</b>\n\n"
                        f"{e('trash')} ከቪአይፒ ቻናሎቹ ተወግደዋል\n\n"
                        f"{e('arrow_right')} ለመቀጠል /start ብለው ክፍያ ይፈጽሙ።",
                        parse_mode="HTML",
                    )
                except Exception:
                    pass

            # ── ነገ ሊያልቅ የቀረባቸው (ሁለቴ እንዳይደርሳቸው _notified_expiring ይፈትሻል) ──
            for user in await get_expiring_soon_users(days=1):
                uid = user["user_id"]
                if uid in _notified_expiring:
                    continue  # አስቀድሞ ማስጠንቀቂያ ደርሷቸዋል
                try:
                    await bot.send_message(
                        uid,
                        f"{e('warning')} <b>ማሳወቂያ: ጊዜዎ ነገ ያልቃል!</b>\n\n"
                        f"{e('calendar')} የቪአይፒ ጊዜዎ ነገ ያብቃል\n"
                        f"{e('arrow_right')} ሳይቋረጥ ለመቀጠል /start ብለው ያድሱ።",
                        parse_mode="HTML",
                    )
                    _notified_expiring.add(uid)
                except Exception:
                    pass

            consecutive_errors = 0  # ስኬታማ ዑደት — error counter ዳግም ጀምር

        except Exception as ex:
            consecutive_errors += 1
            # Exponential backoff: 60s, 120s, 240s, 480s... (ከፍተኛው 10 ደቂቃ)
            wait = min(60 * (2 ** (consecutive_errors - 1)), 600)
            logger.error(f"Expiry checker error (attempt {consecutive_errors}), retrying in {wait}s: {ex}")
            await asyncio.sleep(wait)
            continue

        await asyncio.sleep(60)
