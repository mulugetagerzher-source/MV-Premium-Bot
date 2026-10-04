from aiogram import Router, F, types, Bot
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from utils.emoji import e
import config

post_router = Router()

class PostState(StatesGroup):
    waiting_for_content = State()


@post_router.message(F.text == "📢 Post to Channel")
async def start_post(message: types.Message, state: FSMContext):
    if not config.is_admin(message.from_user.id):
        return
    await message.answer(
        f"{e('broadcast')} <b>ወደ ቻናሎች ማሰራጫ</b>\n\n"
        "ለመለጠፍ የፈለጉትን ይላኩ።\nለመሰረዝ <code>cancel</code> ብለው ይላኩ።",
        parse_mode="HTML",
    )
    await state.set_state(PostState.waiting_for_content)


@post_router.message(PostState.waiting_for_content)
async def broadcast_post(message: types.Message, state: FSMContext, bot: Bot):
    if message.text and message.text.lower() == "cancel":
        await state.clear()
        await message.answer(f"{e('error')} ማሰራጫው ተሰርዟል።", parse_mode="HTML")
        return

    sent = errors = 0
    status = await message.answer(
        f"{e('processing')} በማሰራጨት ላይ {e('black_circle')}",
        parse_mode="HTML",
    )
    for chat_id in config.CHANNELS:
        try:
            await message.copy_to(chat_id=chat_id)
            sent += 1
        except Exception:
            errors += 1

    await state.clear()
    await status.edit_text(
        f"{e('check')} <b>ማሰራጨቱ ተጠናቋል!</b>\n\n"
        f"{e('broadcast')} ለ {sent} ቻናሎች ተልኳል\n"
        f"{e('warning')} {errors} ቻናሎች ላይ ስህተት",
        parse_mode="HTML",
    )
