import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
import { createSupabaseAdmin } from "@/lib/supabase";
import { BOT_CONFIG } from "@/lib/config";
import { sendMessage, banChatMember, unbanChatMember } from "@/lib/telegram/bot";

export async function GET() {
  try {
    const supabase = createSupabaseAdmin();
    const nowIso = new Date().toISOString();
    const nowTime = Date.now();
    const tomorrowIso = new Date(nowTime + 24 * 60 * 60 * 1000).toISOString();

    // 1. Find users whose VIP has expired
    const { data: expiredUsers, error } = await supabase
      .from("users")
      .select("user_id, full_name, expiry_date")
      .eq("is_vip", 1)
      .lte("expiry_date", nowIso);

    if (error) {
      throw error;
    }

    const deactivations: number[] = [];

    for (const u of expiredUsers || []) {
      // Kick user from all 49 VIP channels
      for (const channelId of BOT_CONFIG.channels) {
        try {
          await banChatMember(channelId, u.user_id, BOT_CONFIG.botToken);
          await unbanChatMember(channelId, u.user_id, BOT_CONFIG.botToken); // ban + unban removes/kicks member
        } catch {
          // Continue if bot lacks admin rights in a specific channel
        }
      }
      await supabase
        .from("users")
        .update({ is_vip: 0 })
        .eq("user_id", u.user_id);

      // Send removal & renewal message
      try {
        await sendMessage(
          u.user_id,
          `⚠️ <b>የቪአይፒ ጊዜዎ አብቅቷል!</b>\n\nውድ <b>${u.full_name || "ተጠቃሚ"}</b>፣ የቪአይፒ ምዝገባ ጊዜዎ ስላለቀ ከቻናሎቹ ተወግደዋል።\n\n` +
          `ሳይቋረጥ ዳግም ለመቀላቀል /start ብለው አዲስ ጥቅል መምረጥ ይችላሉ።`,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: "🔄 VIP አድስ (Renew VIP)", callback_data: "buy_vip" }],
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

    // 2. Advance Warning: Notify users whose VIP expires in the next 24 hours
    const { data: expiringSoonUsers } = await supabase
      .from("users")
      .select("user_id, full_name, expiry_date")
      .eq("is_vip", 1)
      .gt("expiry_date", nowIso)
      .lte("expiry_date", tomorrowIso);

    for (const u of expiringSoonUsers || []) {
      try {
        await sendMessage(
          u.user_id,
          `⏳ <b>ማሳሰቢያ: የቪአይፒ ጊዜዎ ነገ ያበቃል!</b>\n\nውድ <b>${u.full_name || "ተጠቃሚ"}</b>፣ የቪአይፒ አባልነትዎ በ24 ሰዓት ውስጥ ይጠናቀቃል።\n` +
          `ከቻናሎቹ ሳይወጡ አገልግሎቱን ለመቀጠል /start ብለው አስቀድመው ያድሱ።`,
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
      } catch {
        // Ignore notification errors
      }
    }

    return NextResponse.json({
      ok: true,
      timestamp: nowIso,
      expiredCount: deactivations.length,
      deactivatedUserIds: deactivations,
      expiringSoonCount: (expiringSoonUsers || []).length,
    });
  } catch (error: any) {
    console.error("Cron cleanup error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
