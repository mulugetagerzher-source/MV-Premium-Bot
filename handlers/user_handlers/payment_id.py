import inspect
import logging
from aiogram import F, Router, types
from aiogram.fsm.context import FSMContext
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, Message, ReplyKeyboardMarkup, KeyboardButton, WebAppInfo

import config
import ocr_utils
from database import activate_vip, get_payment_by_tid, add_payment, get_user_phone
from handlers.user_handlers.deposit import PaymentState
from receipt_checker import VERIFIERS
from utils.emoji import e, e_id

payment_id_router = Router()
logger = logging.getLogger(__name__)


async def _verify_and_finalize(message: Message, state: FSMContext,
                                tid: str, verify_input: str,
                                ocr_payer_name: str | None = None):
    user_id   = message.from_user.id
    tg_name   = message.from_user.full_name
    user_data = await state.get_data()
    package_key    = user_data.get("selected_package")
    payment_method = user_data.get("payment_method", "telebirr")

    if not package_key:
        await message.answer(f"{e('warning')} /start ብለው ደግሞ ይሞክሩ።", parse_mode="HTML")
        return

    # ── TID duplicate check ──────────────────────────────────────────────
    existing = await get_payment_by_tid(tid)

    if existing:
        await message.answer(
            f"{e('error')} <b>ትራንዛክሽን ቁጥሩ አስቀድሞ ጥቅም ላይ ውሏል!</b>\n"
            "ትክክለኛ አዲስ ቁጥር ይላኩ።",
            parse_mode="HTML",
        )
        return

    expected = config.PACKAGES[package_key]["price"]
    proc = await message.answer(
        f"{e('processing')} ደረሰኙን በማረጋገጥ ላይ ነኝ {e('black_circle')}",
        parse_mode="HTML",
    )

    # ── Verification ─────────────────────────────────────────────────────
    try:
        verifier = VERIFIERS.get(payment_method, VERIFIERS["telebirr"])
        result   = verifier(verify_input, expected)
        if inspect.isawaitable(result):
            result = await result
        if len(result) == 6:
            is_valid, check_msg, actual_amount, p_name, p_phone, auth_ref = result
            if auth_ref:
                tid = auth_ref
        else:
            is_valid, check_msg, actual_amount, p_name, p_phone = result

        # ደረሰኙ ፎቶ/OCR ላይ የተነበበውን የከፋይ ሙሉ ስም ቀዳሚ አድርግ
        if ocr_payer_name:
            if not p_name or str(p_name).strip() in ("", "None") or len(ocr_payer_name) > len(str(p_name)):
                p_name = ocr_payer_name
    except Exception as ex:
        logger.error(f"Verification Error: {ex}")
        is_valid, check_msg, actual_amount, p_name, p_phone = (
            False, f"{e('error')} ማረጋገጫ ላይ ስህተት ተፈጠረ። ደግሞ ይሞክሩ።",
            None, None, None,
        )

    # ── Registered phone ─────────────────────────────────────────────────
    phone_val = await get_user_phone(user_id)
    registered_phone = phone_val if phone_val else "None"

    await proc.delete()

    if not is_valid:
        await message.answer(
            f"{check_msg}\n\n"
            f"{e('bell')} ችግር ካጋጠሙ {e('arrow_right')} {config.SUPPORT_CONTACT}",
            parse_mode="HTML",
        )
        return

    # ── Telebirr phone match ─────────────────────────────────────────────
    if payment_method == "telebirr" and registered_phone != "None" and p_phone:
        if not p_phone.endswith(registered_phone[-4:]):
            await message.answer(
                f"{e('error')} <b>የስልክ ቁጥር ስህተት</b>\n\n"
                f"ያስመዘገቡት: <code>{registered_phone}</code>\n"
                f"የከፈሉበት:  <code>{p_phone}</code>\n\n"
                "እባክዎ በከፈሉበት ስልክ ቁጥር ተምዝግበው ደግሞ ይሞክሩ።",
                parse_mode="HTML",
            )
            return

    # ── Save to DB ───────────────────────────────────────────────────────
    saved = await add_payment(
        user_id=user_id,
        payer_name=p_name or "",
        phone=registered_phone,
        transaction_id=tid,
        amount=actual_amount or 0.0,
        bank=payment_method
    )
    if not saved:
        await message.answer(
            f"{e('error')} <b>ትራንዛክሽን ቁጥሩ አስቀድሞ ጥቅም ላይ ውሏል!</b>",
            parse_mode="HTML",
        )
        return

    # ── VIP activate + unban ─────────────────────────────────────────────
    await activate_vip(user_id, package_key)

    one_time_link = config.VIP_LINK  # button forward ቢደረግ URL አይሄድም
    for chat_id in config.CHANNELS:
        try:
            await message.bot.unban_chat_member(
                chat_id=chat_id, user_id=user_id, only_if_banned=True
            )
        except Exception as ex:
            logger.debug(f"Unban skip {chat_id}: {ex}")

    # ── Success ──────────────────────────────────────────────────────────
    method_labels = {
        "cbe":      f"{e('cbe')} CBE",
        "boa":      f"{e('abyssinia')} Abyssinia",
        "awash":    "🏦 Awash",
        "telebirr": f"{e('telebirr')} Telebirr",
    }
    method_label = method_labels.get(payment_method, f"{e('telebirr')} Telebirr")

    # method label — icon ብቻ (HTML tag የለም)
    method_icons = {
        "cbe":      e("cbe"),
        "boa":      e("abyssinia"),
        "awash":    "🏦",
        "telebirr": e("telebirr"),
    }
    method_icon = method_icons.get(payment_method, e("telebirr"))
    method_name = {
        "cbe": "CBE", "boa": "Abyssinia",
        "awash": "Awash", "telebirr": "Telebirr",
    }.get(payment_method, "Telebirr")

    report = (
        f"{e('green_check')} <b>ክፍያዎ ተረጋግጧል!</b>\n\n"
        f"የክፍያ ዘዴ: {method_icon} {method_name}\n"
        f"{e('msg_tele')} ቴሌ ስም: {tg_name}\n"
        f"{e('msg_payer')} ከፋይ ስም: {p_name if p_name else 'ያልተገኘ'}\n"
        f"{e('msg_phone')} ስልክ: {registered_phone}\n"
        f"{e('msg_amount')} መጠን: {actual_amount} ብር\n"
        f"{e('msg_tid')} TID: <code>{tid}</code>\n"
        f"{e('msg_userid')} User ID: <code>{user_id}</code>\n\n"
        f"{e('star')} ጥያቄዎ ተቀባይነት አግኝቷል! የቪአይፒ ቻናሉን መቀላቀል ይችላሉ።"
    )
    # kb ወደ vip_kb ተቀይሯል (ከታች ያለ)
    # ── Success report (protect_content=True → forward አይደረግም) ────────────
    await message.answer(report, parse_mode="HTML", protect_content=True)

    # ── VIP link button ────────────────────────────────────────────────────────
    # protect_content=True ስለሆነ forward ማድረግ አይቻልም
    # InlineKeyboardButton(url=) — Telegram ውስጥ ብቻ ይሰራል
    from aiogram.types import InlineKeyboardMarkup as IKM, InlineKeyboardButton as IKB
    from aiogram.types import ReplyKeyboardRemove
    vip_kb = IKM(inline_keyboard=[[
        IKB(
            text="🚪 VIP ቻናሉን ለመቀላቀል",
            url=one_time_link,
        )
    ]])
    await message.answer(
        f"{e('down_arrow')} ቻናሉን ለመቀላቀል ከታች ያለውን ቁልፍ ይጫኑ:",
        reply_markup=vip_kb,
        parse_mode="HTML",
        protect_content=True,
    )

    for aid in config.ADMIN_IDS:
        try:
            await message.bot.send_message(
                aid,
                f"{e('bell')} <b>አዲስ ክፍያ ተረጋግጧል</b>\n\n{report}",
                parse_mode="HTML",
            )
        except Exception as ex:
            logger.error(f"Admin notify {aid}: {ex}")

    await state.clear()


def _build_verify_input(method: str, reference: str) -> str:
    if method == "boa":
        return ocr_utils.build_boa_url(reference)
    if method == "awash":
        return ocr_utils.build_awash_url(reference)
    return reference


# ── Text ─────────────────────────────────────────────────────────────────────
@payment_id_router.message(PaymentState.waiting_for_tid, F.text)
async def process_transaction_id(message: Message, state: FSMContext):
    tid      = message.text.strip()
    method   = (await state.get_data()).get("payment_method", "telebirr")
    verify   = tid if method in ("cbe", "boa", "awash") else tid.upper()
    ocr_name = ocr_utils.extract_payer_name_from_text(tid)
    await _verify_and_finalize(message, state, tid, verify, ocr_payer_name=ocr_name)


# ── Photo / Screenshot ────────────────────────────────────────────────────────
@payment_id_router.message(PaymentState.waiting_for_tid, F.photo)
async def process_receipt_photo(message: Message, state: FSMContext):
    method = (await state.get_data()).get("payment_method", "telebirr")
    proc   = await message.answer(
        f"{e('processing')} ደረሰኙን ፎቶ ላይ ቁጥር እና ከፋይ ስም በመፈለግ ላይ {e('black_circle')}",
        parse_mode="HTML",
    )
    photo     = message.photo[-1]
    file      = await message.bot.get_file(photo.file_id)
    img_bytes = (await message.bot.download_file(file.file_path)).read()
    reference = ocr_utils.extract_reference_from_image_bytes(img_bytes, method)
    ocr_name  = ocr_utils.extract_payer_name_from_image_bytes(img_bytes)
    await proc.delete()

    if not reference:
        await message.answer(
            f"{e('error')} ከፎቶው ላይ ቁጥሩን ማንበብ አልቻልኩም {e('warning')}\n\n"
            f"• QR ኮዱ ግልጽ ሆኖ ይታይ\n"
            f"• ወይም ቁጥሩን/ሊንኩን በጽሁፍ ይተይቡ",
            parse_mode="HTML",
        )
        return
    await _verify_and_finalize(message, state, reference,
                                _build_verify_input(method, reference),
                                ocr_payer_name=ocr_name)


# ── Document / PDF ────────────────────────────────────────────────────────────
@payment_id_router.message(PaymentState.waiting_for_tid, F.document)
async def process_receipt_document(message: Message, state: FSMContext):
    method = (await state.get_data()).get("payment_method", "telebirr")
    proc   = await message.answer(
        f"{e('processing')} ፋይሉን ላይ ቁጥር እና ከፋይ ስም በመፈለግ ላይ {e('black_circle')}",
        parse_mode="HTML",
    )
    doc        = message.document
    file       = await message.bot.get_file(doc.file_id)
    file_bytes = (await message.bot.download_file(file.file_path)).read()
    mime       = (doc.mime_type or "").lower()
    name       = (doc.file_name or "").lower()

    ocr_name = None
    if "pdf" in mime or name.endswith(".pdf"):
        reference = ocr_utils.extract_reference_from_pdf_bytes(file_bytes, method)
        ocr_name  = ocr_utils.extract_payer_name_from_pdf_bytes(file_bytes)
    elif mime.startswith("image/") or name.endswith((".png", ".jpg", ".jpeg", ".webp")):
        reference = ocr_utils.extract_reference_from_image_bytes(file_bytes, method)
        ocr_name  = ocr_utils.extract_payer_name_from_image_bytes(file_bytes)
    else:
        await proc.delete()
        await message.answer(
            f"{e('error')} PDF ወይም ምስል (ፎቶ) ብቻ ይላኩ።",
            parse_mode="HTML",
        )
        return

    await proc.delete()
    if not reference:
        await message.answer(
            f"{e('error')} ከፋይሉ ላይ ቁጥሩን ማንበብ አልቻልኩም\n"
            f"ቁጥሩን/ሊንኩን በጽሁፍ ይተይቡ",
            parse_mode="HTML",
        )
        return
    await _verify_and_finalize(message, state, reference,
                                _build_verify_input(method, reference),
                                ocr_payer_name=ocr_name)
