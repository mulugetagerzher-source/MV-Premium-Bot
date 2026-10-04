from aiogram import Router, F, types
from database import activate_vip
from utils.emoji import e, e_id
import config

approve_router = Router()


@approve_router.callback_query(F.data.startswith("apruv_"))
async def approve_payment(callback: types.CallbackQuery):
    if not config.is_admin(callback.from_user.id):
        return
    parts       = callback.data.split("_")
    user_id     = int(parts[1])
    package_key = parts[2]
    await activate_vip(user_id, package_key)

    kb = types.InlineKeyboardMarkup(inline_keyboard=[
        [types.InlineKeyboardButton(
            text="VIP ቻናሉን ለመቀላቀል",
            url=config.VIP_LINK,
            icon_custom_emoji_id=e_id("vip_door"),
        )]
    ])
    try:
        await callback.bot.send_message(
            user_id,
            f"{e('green_check')} ክፍያዎ ጸድቋል! ቻናሉን ይቀላቀሉ።",
            reply_markup=kb, parse_mode="HTML",
        )
    except Exception:
        pass
    await callback.message.edit_text(
        f"{e('green_check')} <b>ክፍያ ጸድቋል!</b>\n"
        f"User: <code>{user_id}</code> | Package: <code>{package_key}</code>",
        parse_mode="HTML",
    )
    await callback.answer("ጸድቋል!")


@approve_router.callback_query(F.data.startswith("dany_"))
async def deny_payment(callback: types.CallbackQuery):
    if not config.is_admin(callback.from_user.id):
        return
    user_id = int(callback.data.split("_")[1])
    try:
        await callback.bot.send_message(
            user_id,
            f"{e('error')} ያስገቡት ትራንዛክሽን ቁጥር ትክክል አይደለም። ትክክለኛ ቁጥር ይላኩ።",
            parse_mode="HTML",
        )
    except Exception:
        pass
    await callback.message.edit_text(f"{e('error')} ክፍያው ውድቅ ተደርጓል።", parse_mode="HTML")
    await callback.answer("ውድቅ")
