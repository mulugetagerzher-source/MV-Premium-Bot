import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase";
import { BOT_CONFIG } from "@/lib/config";
import { sendMessage } from "@/lib/telegram/bot";

export async function GET() {
  try {
    const supabase = createSupabaseAdmin();
    const nowIso = new Date().toISOString();

    // 1. Find users whose VIP has expired
    const { data: expiredUsers, error } = await supabase
      .from("users")
      .select("user_id, full_name, expiry_date")
      .eq("is_vip", 1)
      .lte("expiry_date", nowIso);

    if (error) {
      throw error;
    }

    const deactivations = [];

    for (const u of expiredUsers || []) {
      // Mark VIP as expired in DB
      await supabase
        .from("users")
        .update({ is_vip: 0 })
        .eq("user_id", u.user_id);

      // Send renewal reminder to user
      try {
        await sendMessage(
          u.user_id,
          `⚠️ <b>የቪአይፒ ጊዜዎ አብቅቷል!</b>\n\nውድ <b>${u.full_name || "ተጠቃሚ"}</b>፣ የቪአይፒ ምዝገባዎ ዛሬ ተጠናቋል።\n` +
          `ዳግም ለማደስ /start ብለው የጥቅል ክፍያ መፈጸም ይችላሉ።`,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: "🔄 VIP አድስ", callback_data: "buy_vip" }],
              ],
            },
            botToken: BOT_CONFIG.botToken,
          }
        );
      } catch (err) {
        console.warn(`Could not send expiry message to ${u.user_id}:`, err);
      }

      deactivations.push(u.user_id);
    }

    return NextResponse.json({
      ok: true,
      timestamp: nowIso,
      expiredCount: deactivations.length,
      deactivatedUserIds: deactivations,
    });
  } catch (error: any) {
    console.error("Cron cleanup error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
