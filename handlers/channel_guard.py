"""
channel_guard.py — VIP Channel Guard
=====================================
አዲስ member ቻናል ሲቀላቀል:
  1. ቦቱ DB ያረጋግጣል — is_vip=1 ነው?
  2. ክፍያ ካልከፈለ / start ያላለ → ወዲያው kick
  3. ክፍያ ከፍሎ ጊዜ ካለቀ → kick
"""
import logging
from aiogram import Router, F, types
from aiogram.types import ChatMemberUpdated
import config
from database import is_user_vip
from utils.emoji import e

channel_guard_router = Router()
logger = logging.getLogger(__name__)


@channel_guard_router.chat_member(
    F.chat.id.in_(set(config.CHANNELS))
)
async def guard_new_member(event: ChatMemberUpdated):
    """
    chat_member event — ተጠቃሚ ሲቀላቀል ይሰማል።
    old_status: left/kicked → new_status: member/restricted
    """
    old = event.old_chat_member.status
    new = event.new_chat_member.status

    # ቀላቀለ? (left/kicked → member)
    joined = (
        old in ("left", "kicked") and
        new in ("member", "restricted", "administrator", "creator")
    )
    if not joined:
        return

    user    = event.new_chat_member.user
    user_id = user.id
    chat_id = event.chat.id

    # ── Bot ራሱ ከሆነ አትንካ ─────────────────────────────────────────────────
    if user.is_bot:
        return

    # ── Admin ከሆነ አትንካ ───────────────────────────────────────────────────
    if config.is_admin(user_id):
        return

    # ── DB ያረጋግጣ ─────────────────────────────────────────────────────────
    try:
        if await is_user_vip(user_id):
            return
    except Exception as ex:
        logger.error(f"Guard DB error: {ex}")
        return

    # ── Kick functionality disabled as requested by user ──────────────────
    logger.info(f"User {user_id} joined chat {chat_id} (auto-kick disabled).")
    return
