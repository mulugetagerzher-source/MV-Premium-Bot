from aiogram import Router, types
from aiogram.filters import CommandStart
from aiogram.types import (Message, ReplyKeyboardMarkup, KeyboardButton,
                            InlineKeyboardMarkup, InlineKeyboardButton)
from database import add_user
from utils.emoji import e, e_id
import config

start_router = Router()


@start_router.message(CommandStart())
async def cmd_start(message: Message):
    user_id   = message.from_user.id
    username  = message.from_user.username or "No_username"
    full_name = message.from_user.full_name

    await add_user(user_id, username, full_name, None)

    # ── Admin ─────────────────────────────────────────────────────────────
    if config.is_admin(user_id):
        admin_kb = ReplyKeyboardMarkup(
            keyboard=[
                [KeyboardButton(text="📊 Date Info"),      KeyboardButton(text="💰 Payment Info")],
                [KeyboardButton(text="🚫 Ban Users List"),  KeyboardButton(text="🤖 Post to Bot")],
                [KeyboardButton(text="📢 Post to Channel"), KeyboardButton(text="✉️ Send Message")],
            ],
            resize_keyboard=True,
            one_time_keyboard=False,
        )
        await message.answer(
            f"እንኳን ደህና መጡ አድሚን {full_name}! 👋\nየአድሚን ገጽ ተከፍቷል፡",
            reply_markup=admin_kb,
        )
        return

    # ── User — start.py ያልተላከው ፋይል ሎጂክ ──────────────────────────────────
    # Button: icon_custom_emoji_id= parameter ብቻ — HTML tag የለም
    vip_join_keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="VIP ቻናሉን ለመቀላቀል",
                    callback_data="buy_vip",
                    icon_custom_emoji_id=e_id("vip_door"),   # "5447434637880098257"
                )
            ]
        ]
    )

    # Message text: e() — HTML premium emoji ጋር
    welcome_text = (
        f'ሰላም {full_name} {e("wave")}\n\n'
        f'ወደ <b>Wonde {e("smile")}</b> ቦት እንኳን ደህና መጡ።\n\n'
        f'ሁሉንም የቪአይፒ ቻናሎች ለመቀላቀል ከታች ያለውን በተን ይጫኑ።'
    )
    await message.answer(welcome_text, reply_markup=vip_join_keyboard, parse_mode="HTML")
