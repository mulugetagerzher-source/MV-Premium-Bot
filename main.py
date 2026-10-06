import asyncio
import logging
from aiogram import Bot, Dispatcher
from aiogram.fsm.storage.memory import MemoryStorage
from config import BOT_TOKEN
from database import init_db

# የሁሉም በተኖች (Handlers) ዝርዝር
from handlers.user_handlers.start import start_router
from handlers.user_handlers.deposit import deposit_router
from handlers.user_handlers.payment_id import payment_id_router
from handlers.user_handlers.info import info_router
from handlers.admin_handlers.post_bot import post_bot_router
from handlers.admin_handlers.post_channel import post_router
from handlers.admin_handlers.approve import approve_router
from handlers.channel_guard import channel_guard_router
from handlers.admin_handlers.date_info import date_info_router
from handlers.admin_handlers.payment_info import payment_info_router
from handlers.admin_handlers.ban_users import ban_users_router # ወደ ራውተር ተቀይሯል
from handlers.admin_handlers.send_message import send_msg_router
from handlers.admin_handlers.forward_sync import forward_router
from utils.checker import start_expiry_checker

async def main():
    # 1. የቦቱ ሎጊንግ (ስህተቶችን በተርሚናል ላይ ለማየት)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(levelname)s - %(message)s"
    )

    # 2. ቦቱን እና ዲልፓቸሩን ማስነሳት
    bot = Bot(token=BOT_TOKEN)
    dp = Dispatcher(storage=MemoryStorage())

    # 3. ዳታቤዝ ማስጀመር (ቴብሎች ከሌሉ ይፈጥራል)
    await init_db()

    # 4. ራውተሮችን ማገናኘት (ቅደም ተከተሉ ወሳኝ ነው!)
    
    # --- የአድሚን ራውተሮች ---
    dp.include_router(date_info_router)
    dp.include_router(payment_info_router)
    dp.include_router(ban_users_router) # የታገዱ ተጠቃሚዎች ዝርዝር
    dp.include_router(send_msg_router)  # ለተጠቃሚ በ User ID መልእክት መላኪያ
    dp.include_router(approve_router)
    dp.include_router(channel_guard_router)
    dp.include_router(post_router)
    dp.include_router(post_bot_router)
    dp.include_router(forward_router)  # Wonde VIP → Mule VIP ራስ-ገዝ ቅጂ (49 ቻናሎች)
    
    # --- የተጠቃሚ ራውተሮች ---
    dp.include_router(start_router)
    dp.include_router(deposit_router)
    dp.include_router(info_router)
    
    # ትራንዛክሽን ቁጥር መቀበያው (State ስላለው)
    dp.include_router(payment_id_router)

    # 5. ጊዜያቸው ያለቀባቸውን ሰዎች የሚፈትሸውን ስራ (Background Task) ማስጀመር
    # ይህ በየደቂቃው ዳታቤዙን እያየ ጊዜው ያለቀበትን Ban ያደርጋል
    asyncio.create_task(start_expiry_checker(bot))

    # 6. ቦቱን ስራ ማስጀመር
    print("---------------------------------------")
    print("Wonde VIP Bot is successfully running...")
    print("---------------------------------------")
    
    try:
        # ያልተመለሱ መልዕክቶችን ችላ እንዲል (Skip pending updates)
        await bot.delete_webhook(drop_pending_updates=True)
        await dp.start_polling(
            bot,
            allowed_updates=[
                'message',
                'callback_query',
                'chat_member',       # ← channel guard
                'chat_join_request', # ← auto-approve VIP join requests
                'channel_post',      # ← forward_sync (Wonde → Mule)
            ]
        )
    finally:
        await bot.session.close()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        logging.info("Bot stopped by user!")