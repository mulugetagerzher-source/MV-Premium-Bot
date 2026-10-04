from aiogram import Router, F, types
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from utils.emoji import e
import config

send_msg_router = Router()

class SendMessageState(StatesGroup):
    waiting_for_user_id = State()
    waiting_for_text    = State()


@send_msg_router.message(F.text == "✉️ Send Message")
async def start_sending(message: types.Message, state: FSMContext):
    if not config.is_admin(message.from_user.id):
        return
    await message.answer(
        f"{e('person')} መልእክት የሚላክለትን ሰው <b>User ID</b> ያስገቡ:",
        parse_mode="HTML",
    )
    await state.set_state(SendMessageState.waiting_for_user_id)


@send_msg_router.message(SendMessageState.waiting_for_user_id)
async def process_user_id(message: types.Message, state: FSMContext):
    if not message.text or not message.text.strip().lstrip("-").isdigit():
        await message.answer(f"{e('warning')} ትክክለኛ User ID (ቁጥር) ያስገቡ!", parse_mode="HTML")
        return
    await state.update_data(target_id=int(message.text.strip()))
    await message.answer(
        f"{e('broadcast')} ለተጠቃሚው የሚላከውን <b>መልእክት</b> ይጻፉ:",
        parse_mode="HTML",
    )
    await state.set_state(SendMessageState.waiting_for_text)


@send_msg_router.message(SendMessageState.waiting_for_text)
async def send_to_user(message: types.Message, state: FSMContext):
    target_id = (await state.get_data()).get("target_id")
    try:
        await message.bot.send_message(
            target_id,
            f"{e('bell')} <b>ከ Admin የተላከ መልእክት</b>\n\n{message.text}",
            parse_mode="HTML",
        )
        await message.answer(
            f"{e('check')} መልእክቱ ለ <code>{target_id}</code> ተልኳል።",
            parse_mode="HTML",
        )
    except Exception as ex:
        await message.answer(
            f"{e('error')} መልእክቱን መላክ አልተቻለም።\n"
            f"ተጠቃሚው ቦቱን አግዶ ሊሆን ይችላል።\nError: {ex}",
            parse_mode="HTML",
        )
    finally:
        await state.clear()
