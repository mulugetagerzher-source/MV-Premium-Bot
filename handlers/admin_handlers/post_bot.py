import asyncio
from aiogram import Router, F, types, Bot
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from utils.emoji import e
import config
from database import get_all_users

post_bot_router = Router()

class PostBotState(StatesGroup):
    waiting_for_content = State()


@post_bot_router.message(F.text == "🤖 Post to Bot")
async def start_bot_post(message: types.Message, state: FSMContext):
    if message.from_user.id != config.ADMIN_ID:
        return
    await message.answer(
        f"{e('broadcast')} <b>ለሁሉም ተጠቃሚዎች ማሰራጫ</b>\n\n"
        "ለመላክ የሚፈልጉትን ይላኩ።\nለመሰረዝ <code>cancel</code> ብለው ይላኩ።",
        parse_mode="HTML",
    )
    await state.set_state(PostBotState.waiting_for_content)


@post_bot_router.message(PostBotState.waiting_for_content)
async def broadcast_to_users(message: types.Message, state: FSMContext, bot: Bot):
    if message.text and message.text.lower() == "cancel":
        await state.clear()
        await message.answer(f"{e('error')} ማሰራጫው ተሰርዟል።", parse_mode="HTML")
        return

    users = await get_all_users()

    sent = blocked = 0
    status = await message.answer(
        f"{e('processing')} ለ {len(users)} ተጠቃሚዎች በመላክ ላይ {e('black_circle')}",
        parse_mode="HTML",
    )
    for user in users:
        try:
            await message.copy_to(chat_id=user["user_id"])
            sent += 1
            await asyncio.sleep(0.05)
        except Exception:
            blocked += 1

    await state.clear()
    await status.edit_text(
        f"{e('check')} <b>ማሰራጨቱ ተጠናቋል!</b>\n\n"
        f"{e('person')} ለ {sent} ሰዎች ደርሷል\n"
        f"{e('error')} {blocked} ሰዎች ቦቱን አግደዋል",
        parse_mode="HTML",
    )
