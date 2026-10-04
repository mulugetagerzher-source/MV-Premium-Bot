import asyncio
import logging
from database import get_expired_users, get_expiring_soon_users, deactivate_user
from utils.emoji import e
import config

logger = logging.getLogger(__name__)


async def start_expiry_checker(bot):
    while True:
        try:
            for user in await get_expired_users():
                uid = user["user_id"]
                # Channel banning disabled as requested
                await deactivate_user(uid)
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

            for user in await get_expiring_soon_users(days=1):
                try:
                    await bot.send_message(
                        user["user_id"],
                        f"{e('warning')} <b>ማሳወቂያ: ጊዜዎ ነገ ያልቃል!</b>\n\n"
                        f"{e('calendar')} የቪአይፒ ጊዜዎ ነገ ያብቃል\n"
                        f"{e('arrow_right')} ሳይቋረጥ ለመቀጠል /start ብለው ያድሱ።",
                        parse_mode="HTML",
                    )
                except Exception:
                    pass
        except Exception as ex:
            logger.error(f"Expiry checker: {ex}")

        await asyncio.sleep(60)
