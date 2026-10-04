from aiogram import Router, F, types
from database import get_all_vip_users
from datetime import datetime
from utils.emoji import e
import config

date_info_router = Router()


@date_info_router.message(F.text == "📊 Date Info")
async def show_date_info(message: types.Message):
    if not config.is_admin(message.from_user.id):
        return

    users = await get_all_vip_users()
    if not users:
        await message.answer(f"{e('warning_sign')} አሁን ምንም VIP ተጠቃሚ የለም።", parse_mode="HTML")
        return

    # ── Header ───────────────────────────────────────────────────────────────
    title = f"{e('star')} <b>የ VIP ተጠቃሚዎች መረጃ</b>\n\n"

    header = (
        "| No | Name       | Username   | Phone         | User ID    | S/Date   | E/Date   | Exp  |\n"
        "|----|------------|------------|---------------|------------|----------|----------|------|\n"
    )

    rows = ""
    for idx, user in enumerate(users, 1):
        name     = (user.get("full_name") or "Unknown")[:10]
        username = (user.get("username") or "N/A")[:10]
        phone    = (user.get("phone") or "N/A")[:13]
        uid      = str(user.get("user_id") or "")[:10]

        s_raw = user.get("start_date")  or ""
        e_raw = user.get("expiry_date") or ""

        def _parse_date(raw):
            if not raw:
                return None
            try:
                # Handle ISO format (2026-10-04T19:42:19) or space format
                cleaned = str(raw).replace("T", " ").split(".")[0].split("+")[0].strip()
                return datetime.strptime(cleaned, "%Y-%m-%d %H:%M:%S")
            except Exception:
                return None

        s_obj = _parse_date(s_raw)
        e_obj = _parse_date(e_raw)

        s_date = s_obj.strftime("%d/%m/%y") if s_obj else "N/A"
        if e_obj:
            e_date = e_obj.strftime("%d/%m/%y")
            left   = (e_obj - datetime.now()).days
            exp    = f"{left}d" if left >= 0 else "Exp"
        else:
            e_date = "N/A"
            exp    = "?"

        rows += (
            f"| {idx:<2} | {name:<10} | {username:<10} | {phone:<13} | "
            f"{uid:<10} | {s_date:<8} | {e_date:<8} | {exp:<4} |\n"
        )

    full = title + f"<pre>{header}{rows}</pre>"

    # ── Telegram 4096 limit ──────────────────────────────────────────────────
    if len(full) <= 4096:
        await message.answer(full, parse_mode="HTML")
    else:
        await message.answer(title + f"<pre>{header}</pre>", parse_mode="HTML")
        chunk = ""
        for line in rows.splitlines(keepends=True):
            if len(chunk) + len(line) > 3800:
                await message.answer(f"<pre>{chunk}</pre>", parse_mode="HTML")
                chunk = ""
            chunk += line
        if chunk:
            await message.answer(f"<pre>{chunk}</pre>", parse_mode="HTML")
