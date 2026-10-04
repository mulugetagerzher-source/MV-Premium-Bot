import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
import { createSupabaseAdmin } from "@/lib/supabase";
import { BOT_CONFIG, isAdminUser } from "@/lib/config";
import {
  sendMessage,
  editMessageText,
  answerCallbackQuery,
  getFile,
  banChatMember,
  unbanChatMember,
  approveChatJoinRequest,
  declineChatJoinRequest,
} from "@/lib/telegram/bot";
import { verifyPayment } from "@/lib/payments/receiptVerifier";
import { parseBankSms } from "@/lib/sms/bankParser";
import { e, e_id } from "@/lib/telegram/emoji";

// Helper to calculate expiry date based on package or amount
function calculateExpiry(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function getPackageForAmount(amount: number) {
  if (amount >= 3000) return BOT_CONFIG.packages["1year"];
  if (amount >= 1600) return BOT_CONFIG.packages["6month"];
  if (amount >= 800)  return BOT_CONFIG.packages["3month"];
  if (amount >= 600)  return BOT_CONFIG.packages["2month"];
  return BOT_CONFIG.packages["1month"];
}

const processedUpdates = new Set<number>();

export async function POST(req: NextRequest) {
  try {
    const update = await req.json();

    // Prevent Telegram retry loops from delivering the same message multiple times
    if (update.update_id) {
      if (processedUpdates.has(update.update_id)) {
        return NextResponse.json({ ok: true, note: "duplicate acknowledged" });
      }
      processedUpdates.add(update.update_id);
      if (processedUpdates.size > 2000) {
        processedUpdates.clear();
      }
    }

    const supabase = createSupabaseAdmin();
    const token = BOT_CONFIG.botToken;

    // ─────────────────────────────────────────────────────────────
    // 1. CALLBACK QUERIES
    // ─────────────────────────────────────────────────────────────
    if (update.callback_query) {
      const cq = update.callback_query;
      const data = cq.data as string;
      const chatId = cq.message?.chat?.id;
      const messageId = cq.message?.message_id;
      const userId = cq.from.id;
      const fullName = cq.from.first_name || "User";

      await answerCallbackQuery(cq.id, undefined, false, token);

      if (!chatId || !messageId) {
        return NextResponse.json({ ok: true });
      }

      // Action: Cancel Order / Back to Start
      if (data === "cancel_order") {
        await editMessageText(
          chatId,
          messageId,
          `ሰላም <b>${fullName}</b> ${e("wave")}\n\nወደ <b>Wonde ${e("smile")}</b> ቦት እንኳን ደህና መጡ።\n\nሁሉንም የቪአይፒ ቻናሎች ለመቀላቀል ከታች ያለውን በተን ይጫኑ።`,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: "VIP ቻናሉን ለመቀላቀል", callback_data: "buy_vip", icon_custom_emoji_id: e_id("vip_door") }],
              ],
            },
            botToken: token,
          }
        );
        return NextResponse.json({ ok: true });
      }

      // Action: buy_vip -> Show Deposit / Info
      if (data === "buy_vip") {
        await editMessageText(
          chatId,
          messageId,
          `${e("down_arrow")} የሚፈልጉትን ይምረጡ:`,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: "Deposit", callback_data: "make_deposit", icon_custom_emoji_id: e_id("wallet") }],
                [{ text: "ስለ VIP ቻናሎቻችን ለማወቅ", callback_data: "vip_info", icon_custom_emoji_id: e_id("smile") }],
                [{ text: "Cancel Order", callback_data: "cancel_order", icon_custom_emoji_id: e_id("cancel") }],
              ],
            },
            botToken: token,
          }
        );
        return NextResponse.json({ ok: true });
      }

      // Action: vip_info
      if (data === "vip_info") {
        await editMessageText(
          chatId,
          messageId,
          `${e("star")} <b>Wonde VIP Channels Info</b>\n\n• ዕለታዊ የቪአይፒ መረጃዎችና አዳዲስ ጥቆማዎች\n• 49+ ፕሪሚየም ቻናሎችን በአንድ ሊንክ ያገኛሉ\n• ፈጣንና አስተማማኝ አውቶማቲክ አሰራር\n\nእርዳታ ከፈለጉ ➡️ ${BOT_CONFIG.supportContact}`,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: "Deposit", callback_data: "make_deposit", icon_custom_emoji_id: e_id("wallet") }],
                [{ text: "Back", callback_data: "buy_vip", icon_custom_emoji_id: e_id("back") }],
              ],
            },
            botToken: token,
          }
        );
        return NextResponse.json({ ok: true });
      }

      // Action: make_deposit -> Show packages
      if (data === "make_deposit") {
        const pkgButtons: any[][] = Object.values(BOT_CONFIG.packages).map((pkg) => [
          { text: pkg.label, callback_data: `pkg_${pkg.key}`, icon_custom_emoji_id: e_id("pkg_check") },
        ]);
        pkgButtons.push([
          { text: "Back", callback_data: "buy_vip", icon_custom_emoji_id: e_id("back") },
          { text: "Cancel Order", callback_data: "cancel_order", icon_custom_emoji_id: e_id("cancel") },
        ]);

        await editMessageText(
          chatId,
          messageId,
          `${e("dollar")} ከታች ከተዘረዘሩት ጥቅሎች የሚፈልጉትን ይምረጡ:`,
          {
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: pkgButtons },
            botToken: token,
          }
        );
        return NextResponse.json({ ok: true });
      }

      // Action: Select Package -> Check Phone -> Show Payment Methods
      if (data.startsWith("pkg_")) {
        const pkgKey = data.replace("pkg_", "");
        const pkg = BOT_CONFIG.packages[pkgKey] || BOT_CONFIG.packages["1month"];

        // Check if user already has phone registered in Supabase
        const { data: userRow } = await supabase
          .from("users")
          .select("phone")
          .eq("user_id", userId)
          .single();

        const hasPhone = Boolean(
          userRow?.phone &&
          userRow.phone.trim() &&
          userRow.phone !== "None" &&
          userRow.phone !== "Not shared"
        );

        // Record chosen package for user
        await supabase.from("users").upsert({
          user_id: userId,
          package: pkgKey,
        }, { onConflict: "user_id" });

        if (!hasPhone) {
          // Ask user to share their phone number
          await sendMessage(
            chatId,
            `📱 <b>ስልክ ቁጥርዎን ያጋሩ</b>\n\n` +
            `ክፍያዎን በራስ-ሰር ለማረጋገጥ እና የቪአይፒ ምዝገባዎን ለማጠናቀቅ እባክዎ ከታች ያለውን <b>"📲 ስልክ ቁጥሬን ላክ"</b> የሚለውን በተን ይጫኑ ወይም ስልክ ቁጥርዎን በፅሁፍ ይላኩ (ምሳሌ፡ 0911223344)።`,
            {
              parse_mode: "HTML",
              reply_markup: {
                keyboard: [
                  [{ text: "📲 ስልክ ቁጥሬን ላክ", request_contact: true }],
                ],
                resize_keyboard: true,
                one_time_keyboard: true,
              },
              botToken: token,
            }
          );
          return NextResponse.json({ ok: true });
        }

        await editMessageText(
          chatId,
          messageId,
          `${e("wallet")} የክፍያ ዘዴ ይምረጡ:`,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: "Telebirr", callback_data: `pay_tele_${pkgKey}`, icon_custom_emoji_id: e_id("telebirr") }],
                [{ text: "CBE Birr", callback_data: `pay_cbe_${pkgKey}`, icon_custom_emoji_id: e_id("cbe") }],
                [{ text: "Bank of Abyssinia", callback_data: `pay_boa_${pkgKey}`, icon_custom_emoji_id: e_id("abyssinia") }],
                [{ text: "Awash Bank", callback_data: `pay_awash_${pkgKey}` }],
                [
                  { text: "Back", callback_data: "make_deposit", icon_custom_emoji_id: e_id("back") },
                  { text: "Cancel Order", callback_data: "cancel_order", icon_custom_emoji_id: e_id("cancel") },
                ],
              ],
            },
            botToken: token,
          }
        );
        return NextResponse.json({ ok: true });
      }

      // Action: Payment Details (Telebirr, CBE, BOA, Awash)
      if (data.startsWith("pay_")) {
        const parts = data.split("_");
        const method = parts[1];
        const pkgKey = parts[2] || "1month";
        const pkg = BOT_CONFIG.packages[pkgKey] || BOT_CONFIG.packages["1month"];

        let title = `${e("telebirr")} <b>Telebirr</b>`;
        let acct = `ቁጥር: <code>${BOT_CONFIG.telebirrNumber}</code>`;
        let tip = `${e("paid_check")} ከከፈሉ በኋላ TID ቁጥሩን ወይም screenshot ለቦቱ ይላኩ\nምሳሌ TID: <code>CD68C1BD7V</code>`;

        if (method === "cbe") {
          title = `${e("cbe")} <b>CBE Birr</b>`;
          acct = `Account: <code>${BOT_CONFIG.cbeAccount}</code>`;
          tip = `${e("paid_check")} ከከፈሉ በኋላ CBE app ደረሰኝ ሊንክ ወይም screenshot ይላኩ\nምሳሌ: <code>https://mbreciept.cbe.com.et/v2-AbCdXyz</code>`;
        } else if (method === "boa") {
          title = `${e("abyssinia")} <b>Bank of Abyssinia</b>`;
          acct = `Account: <code>${BOT_CONFIG.abyssiniaAccount}</code>`;
          tip = `${e("paid_check")} ከከፈሉ በኋላ ደረሰኝ ሊንክ ወይም screenshot ይላኩ\nምሳሌ: <code>https://cs.bankofabyssinia.com/slip/?trx=...</code>`;
        } else if (method === "awash") {
          title = `🏦 <b>Awash Bank</b>`;
          acct = `Account: <code>${BOT_CONFIG.awashAccount}</code>`;
          tip = `${e("paid_check")} ከከፈሉ በኋላ ደረሰኝ ሊንክ ወይም screenshot ይላኩ።`;
        }

        const msg =
          `${title}\n\n` +
          `${acct}\n` +
          `ስም ➡️ <b>${BOT_CONFIG.accountName}</b>\n\n` +
          `${e("dollar")} ሊከፍሉ ያለው: <b>${pkg.price} ብር</b>\n\n` +
          `${tip}\n\n` +
          `${e("bell")} ለተጨማሪ መረጃ ➡️ ${BOT_CONFIG.supportContact} ያናግሩን።`;

        await editMessageText(chatId, messageId, msg, {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "I have paid ✅", callback_data: `confirm_${method}_${pkgKey}`, icon_custom_emoji_id: e_id("paid_check") }],
              [
                { text: "Back", callback_data: `pkg_${pkgKey}`, icon_custom_emoji_id: e_id("back") },
                { text: "Cancel Order", callback_data: "cancel_order", icon_custom_emoji_id: e_id("cancel") },
              ],
            ],
          },
          botToken: token,
        });
        return NextResponse.json({ ok: true });
      }

      // Action: Confirm Prompt
      if (data.startsWith("confirm_")) {
        const parts = data.split("_");
        const method = parts[1];
        const pkgKey = parts[2] || "1month";

        await editMessageText(
          chatId,
          messageId,
          `📩 እባክዎ አሁን የደረሰኙን ስክሪንሾት (Screenshot) ወይም የትራንዛክሽን ቁጥር (TID / SMS) ይላኩ።\n\nቦቱ አውቶማቲክ አረጋግጦ የቪአይፒ ሊንኩን ይሰጥዎታል።`,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "Back", callback_data: `pay_${method}_${pkgKey}`, icon_custom_emoji_id: e_id("back") },
                  { text: "Cancel Order", callback_data: "cancel_order", icon_custom_emoji_id: e_id("cancel") },
                ],
              ],
            },
            botToken: token,
          }
        );
        return NextResponse.json({ ok: true });
      }

      return NextResponse.json({ ok: true });
    }

    // ─────────────────────────────────────────────────────────────
    // 2. CHAT MEMBER UPDATES (Channel Guard: Auto-kick expired/non-VIP)
    // ─────────────────────────────────────────────────────────────
    if (update.chat_member) {
      const cm = update.chat_member;
      const channelId = cm.chat.id;
      const user = cm.new_chat_member?.user;
      const userId = user?.id;

      if (user && !user.is_bot && !isAdminUser(userId)) {
        const oldStatus = cm.old_chat_member?.status;
        const newStatus = cm.new_chat_member?.status;
        const joined =
          ["left", "kicked"].includes(oldStatus || "") &&
          ["member", "restricted", "administrator"].includes(newStatus || "");

        if (joined) {
          const { data: dbUser } = await supabase
            .from("users")
            .select("is_vip, expiry_date")
            .eq("user_id", userId)
            .single();

          const isVip =
            dbUser?.is_vip === 1 &&
            (!dbUser.expiry_date || new Date(dbUser.expiry_date).getTime() > Date.now());

          if (!isVip) {
            try {
              await banChatMember(channelId, userId, token);
              await unbanChatMember(channelId, userId, token);
              await sendMessage(
                userId,
                `⚠️ <b>ይቅርታ፣ ንቁ የቪአይፒ አባልነት ስለሌለዎት ከቻናሉ ተወግደዋል።</b>\n\nለመቀላቀል በቦቱ /start ብለው ጥቅል ይምረጡ።`,
                { parse_mode: "HTML", botToken: token }
              );
            } catch (err) {
              console.warn("Channel guard kick error:", err);
            }
          }
        }
      }
      return NextResponse.json({ ok: true });
    }

    // ─────────────────────────────────────────────────────────────
    // 2b. CHAT JOIN REQUESTS (When Admin Approval is required)
    // ─────────────────────────────────────────────────────────────
    if (update.chat_join_request) {
      const cjr = update.chat_join_request;
      const channelId = cjr.chat.id;
      const userId = cjr.from.id;

      if (!isAdminUser(userId)) {
        const { data: dbUser } = await supabase
          .from("users")
          .select("is_vip, expiry_date")
          .eq("user_id", userId)
          .maybeSingle();

        const isVip =
          dbUser?.is_vip === 1 &&
          (!dbUser.expiry_date || new Date(dbUser.expiry_date).getTime() > Date.now());

        if (isVip) {
          try {
            await approveChatJoinRequest(channelId, userId, token);
            await sendMessage(
              userId,
              `✅ <b>የVIP ቻናል መዳረሻ ጥያቄዎ ተቀባይነት አግኝቷል! እንኳን ደህና መጡ።</b>`,
              { parse_mode: "HTML", botToken: token }
            );
          } catch (err) {
            console.warn("Approve join request error:", err);
          }
        } else {
          try {
            await declineChatJoinRequest(channelId, userId, token);
            await sendMessage(
              userId,
              `⚠️ <b>ይቅርታ፣ ንቁ የቪአይፒ አባልነት ስለሌለዎት ጥያቄዎ ውድቅ ተደርጓል።</b>\n\nለመቀላቀል በቦቱ /start ብለው ክፍያ ይፈጽሙ።`,
              { parse_mode: "HTML", botToken: token }
            );
          } catch (err) {
            console.warn("Decline join request error:", err);
          }
        }
      }
      return NextResponse.json({ ok: true });
    }

    // ─────────────────────────────────────────────────────────────
    // 3. MESSAGES (Text, Photo, Commands)
    // ─────────────────────────────────────────────────────────────
    if (update.message) {
      const msg = update.message;
      const chatId = msg.chat.id;
      const userId = msg.from.id;
      const fullName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ");
      const username = msg.from.username || "No_username";
      const text = (msg.text || "").trim();

      // Ensure user is recorded in Supabase
      try {
        await supabase.from("users").upsert(
          {
            user_id: userId,
            full_name: fullName,
            username: username,
          },
          { onConflict: "user_id" }
        );
      } catch (err) {
        console.warn("User upsert note:", err);
      }

      // Command: /start
      if (text === "/start") {
        if (isAdminUser(userId)) {
          await sendMessage(
            chatId,
            `እንኳን ደህና መጡ አድሚን <b>${fullName}</b>! 👋\n\nየአድሚን ገጽዎን በዌብ ወይም ቦት መጠቀም ይችላሉ።\n\n` +
            `🔗 <b>Vercel Web Dashboard:</b> ን ይክፈቱ\n• ተጠቃሚዎችን ማየት\n• ክፍያዎችን ማፅደቅ\n• VIP ማስጀመር`,
            {
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [
                  [{ text: "📊 Open Web Dashboard", web_app: { url: process.env.NEXT_PUBLIC_APP_URL || "https://wonde-vip-admin.vercel.app" } }],
                  [{ text: "🚪 VIP ቻናሉን ለመቀላቀል", callback_data: "buy_vip" }],
                ],
              },
              botToken: token,
            }
          );
          return NextResponse.json({ ok: true });
        }

        // Regular User /start
        await sendMessage(
          chatId,
          `ሰላም <b>${fullName}</b> ${e("wave")}\n\n` +
          `ወደ <b>Wonde ${e("smile")}</b> ቦት እንኳን ደህና መጡ።\n\n` +
          `ሁሉንም የቪአይፒ ቻናሎች ለመቀላቀል ከታች ያለውን በተን ይጫኑ።`,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: "VIP ቻናሉን ለመቀላቀል", callback_data: "buy_vip", icon_custom_emoji_id: e_id("vip_door") }],
              ],
            },
            botToken: token,
          }
        );
        return NextResponse.json({ ok: true });
      }

      // User tapped the bottom persistent menu button: "VIP ቻናሉን ለመቀላቀል"
      if (text.includes("VIP ቻናሉን ለመቀላቀል")) {
        const { data: dbUser } = await supabase
          .from("users")
          .select("is_vip, expiry_date")
          .eq("user_id", userId)
          .single();

        const isVipActive =
          dbUser?.is_vip === 1 &&
          (!dbUser.expiry_date || new Date(dbUser.expiry_date).getTime() > Date.now());

        if (isVipActive) {
          await sendMessage(chatId, "🔐 <b>VIP መዳረሻ:</b>", {
            parse_mode: "HTML",
            reply_markup: { remove_keyboard: true },
            botToken: token,
          });
          await sendMessage(
            chatId,
            `🚪 <b>VIP ቻናሉን ለመቀላቀል ከታች ያለውን ቁልፍ ይጫኑ:</b>`,
            {
              parse_mode: "HTML",
              protect_content: true,
              reply_markup: {
                inline_keyboard: [
                  [{ text: "VIP ቻናሉን ለመቀላቀል", url: BOT_CONFIG.vipLink, icon_custom_emoji_id: e_id("vip_door") }],
                ],
              },
              botToken: token,
            }
          );
        } else {
          await sendMessage(chatId, "⚠️ <b>ክፍያ ያስፈልጋል:</b>", {
            parse_mode: "HTML",
            reply_markup: { remove_keyboard: true },
            botToken: token,
          });
          await sendMessage(
            chatId,
            `⚠️ <b>ይቅርታ! VIP ቻናሉን ለመቀላቀል ንቁ የቪአይፒ ክፍያ ያስፈልጋል።</b>\n\nከታች ከተዘረዘሩት ጥቅሎች የሚፈልጉትን ይምረጡ:`,
            {
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [
                  [{ text: "VIP ቻናሉን ለመቀላቀል", callback_data: "buy_vip", icon_custom_emoji_id: e_id("vip_door") }],
                ],
              },
              botToken: token,
            }
          );
        }
        return NextResponse.json({ ok: true });
      }

      // 1. Check if user shared phone via Telegram Contact
      if (msg.contact) {
        let phone = msg.contact.phone_number;
        if (phone && !phone.startsWith("+") && !phone.startsWith("0")) {
          phone = "+" + phone;
        }

        const { data: userRow } = await supabase
          .from("users")
          .update({ phone })
          .eq("user_id", userId)
          .select()
          .single();

        const selectedPkg = userRow?.package || "1month";

        await sendMessage(
          chatId,
          `✅ <b>ስልክዎ ተመዝግቧል:</b> <code>${phone}</code>\n\nአሁን የክፍያ ዘዴዎን ይምረጡ:`,
          {
            parse_mode: "HTML",
            reply_markup: { remove_keyboard: true },
            botToken: token,
          }
        );

        await sendMessage(
          chatId,
          `${e("wallet")} የክፍያ ዘዴ ይምረጡ:`,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: "Telebirr", callback_data: `pay_tele_${selectedPkg}`, icon_custom_emoji_id: e_id("telebirr") }],
                [{ text: "CBE Birr", callback_data: `pay_cbe_${selectedPkg}`, icon_custom_emoji_id: e_id("cbe") }],
                [{ text: "Bank of Abyssinia", callback_data: `pay_boa_${selectedPkg}`, icon_custom_emoji_id: e_id("abyssinia") }],
                [{ text: "Awash Bank", callback_data: `pay_awash_${selectedPkg}` }],
                [
                  { text: "Back", callback_data: "make_deposit", icon_custom_emoji_id: e_id("back") },
                  { text: "Cancel Order", callback_data: "cancel_order", icon_custom_emoji_id: e_id("cancel") },
                ],
              ],
            },
            botToken: token,
          }
        );
        return NextResponse.json({ ok: true });
      }

      // 2. Check if user typed a phone number (e.g. 0911223344, 0711223344, +251911223344)
      const cleanPhoneCandidate = text.replace(/[\s\-]/g, "");
      if (/^(?:\+?251|0)?[79]\d{8}$/.test(cleanPhoneCandidate)) {
        let formattedPhone = cleanPhoneCandidate;
        if (formattedPhone.startsWith("251")) formattedPhone = "+" + formattedPhone;
        else if (formattedPhone.startsWith("9") || formattedPhone.startsWith("7")) formattedPhone = "0" + formattedPhone;

        const { data: userRow } = await supabase
          .from("users")
          .update({ phone: formattedPhone })
          .eq("user_id", userId)
          .select()
          .single();

        const selectedPkg = userRow?.package || "1month";

        await sendMessage(
          chatId,
          `✅ <b>ስልክዎ ተመዝግቧል:</b> <code>${formattedPhone}</code>\n\nአሁን የክፍያ ዘዴዎን ይምረጡ:`,
          {
            parse_mode: "HTML",
            reply_markup: { remove_keyboard: true },
            botToken: token,
          }
        );

        await sendMessage(
          chatId,
          `${e("wallet")} የክፍያ ዘዴ ይምረጡ:`,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: "Telebirr", callback_data: `pay_tele_${selectedPkg}`, icon_custom_emoji_id: e_id("telebirr") }],
                [{ text: "CBE Birr", callback_data: `pay_cbe_${selectedPkg}`, icon_custom_emoji_id: e_id("cbe") }],
                [{ text: "Bank of Abyssinia", callback_data: `pay_boa_${selectedPkg}`, icon_custom_emoji_id: e_id("abyssinia") }],
                [{ text: "Awash Bank", callback_data: `pay_awash_${selectedPkg}` }],
                [
                  { text: "Back", callback_data: "make_deposit", icon_custom_emoji_id: e_id("back") },
                  { text: "Cancel Order", callback_data: "cancel_order", icon_custom_emoji_id: e_id("cancel") },
                ],
              ],
            },
            botToken: token,
          }
        );
        return NextResponse.json({ ok: true });
      }

      // Receipt Verification Trigger: (Photo OR Text matching Transaction ID / SMS / Link)
      let verifyInput: Buffer | string | null = null;

      if (msg.photo && msg.photo.length > 0) {
        // User sent a photo (receipt screenshot)
        const highestPhoto = msg.photo[msg.photo.length - 1];
        const fileInfo = await getFile(highestPhoto.file_id, token);
        if (fileInfo?.ok && fileInfo?.result?.file_path) {
          const downloadUrl = `https://api.telegram.org/file/bot${token}/${fileInfo.result.file_path}`;
          const res = await fetch(downloadUrl);
          if (res.ok) {
            const arrayBuf = await res.arrayBuffer();
            verifyInput = Buffer.from(arrayBuf);
          }
        }
      } else if (text && text.length >= 6) {
        // User sent a text (TID, bank SMS, or URL)
        verifyInput = text;
      }

      if (verifyInput) {
        // Processing message with premium emojis
        const procMsg = await sendMessage(
          chatId,
          `${e("processing")} ደረሰኙን በማረጋገጥ ላይ ነኝ ${e("black_circle")}`,
          { parse_mode: "HTML", botToken: token }
        );

        let verification = await verifyPayment(verifyInput);

        // If not verified via URL/QR, check if it's a Bank SMS paste
        if (!verification.verified && typeof verifyInput === "string") {
          const parsedSms = parseBankSms(verifyInput);
          if (parsedSms.isBankSms && parsedSms.txnReference) {
            // Re-verify using the extracted transaction reference
            verification = await verifyPayment(parsedSms.txnReference);
            if (!verification.verified && parsedSms.amount >= 300) {
              // Valid bank SMS format
              verification = {
                verified: true,
                bank: parsedSms.bank as any,
                txnReference: parsedSms.txnReference,
                amount: parsedSms.amount,
                currency: "ETB",
                senderName: parsedSms.senderName || parsedSms.account || undefined,
                senderAccount: parsedSms.account,
                status: "SUCCESS",
              };
            }
          }
        }

        // If verified successfully!
        if (verification.verified && verification.txnReference) {
          const tid = verification.txnReference;
          const amount = verification.amount || 300;
          const pkg = getPackageForAmount(amount);
          
          // 1. Check duplicate payment in Supabase
          const { data: existingPayment } = await supabase
            .from("payments")
            .select("id")
            .eq("transaction_id", tid)
            .maybeSingle();

          if (existingPayment) {
            await sendMessage(
              chatId,
              `${e("error")} <b>ትራንዛክሽን ቁጥሩ አስቀድሞ ጥቅም ላይ ውሏል!</b>\nእባክዎ ትክክለኛ አዲስ ቁጥር ይላኩ።`,
              { parse_mode: "HTML", botToken: token }
            );
            return NextResponse.json({ ok: true });
          }

          // 2. Fetch user's registered profile (phone & name)
          const { data: userProfile } = await supabase
            .from("users")
            .select("phone, full_name")
            .eq("user_id", userId)
            .maybeSingle();

          const finalPhone =
            (userProfile?.phone && userProfile.phone !== "None" && userProfile.phone.trim())
              ? userProfile.phone
              : (verification.senderPhone || "None");

          // Payer name strictly from bank receipt / sender account.
          // If the bank portal does not expose the name, fallback to real customer name.
          const payerName =
            verification.senderName?.trim() ||
            verification.senderAccount?.trim() ||
            (verification.senderPhone ? `Account (${verification.senderPhone})` : (userProfile?.full_name || fullName || "N/A"));

          const bankName = verification.bank.toUpperCase();

          // Save payment to Supabase
          await supabase.from("payments").insert({
            user_id: userId,
            payer_name: payerName,
            phone: finalPhone,
            transaction_id: tid,
            amount: amount,
            bank: bankName,
            status: "approved",
          });

          // 3. Activate VIP Subscription in Supabase
          const expiryDate = calculateExpiry(pkg.days);
          await supabase.from("users").upsert({
            user_id: userId,
            full_name: fullName,
            username: username,
            is_vip: 1,
            package: pkg.key,
            expiry_date: expiryDate,
          });

          // 4. Send Success and VIP Link with authentic premium emojis
          const methodIcon =
            bankName === "CBE" ? e("cbe") : bankName === "BOA" || bankName === "ABYSSINIA" ? e("abyssinia") : e("telebirr");

          const successMsg =
            `${e("green_check")} <b>ክፍያዎ ተረጋግጧል!</b>\n\n` +
            `የክፍያ ዘዴ: ${methodIcon} <b>${bankName}</b>\n` +
            `${e("msg_tele")} ቴሌ ስም: <b>${fullName}</b>\n` +
            `${e("msg_payer")} ከፋይ ስም (Bank): <b>${payerName}</b>\n` +
            `${e("msg_phone")} ስልክ: <b>${finalPhone}</b>\n` +
            `${e("msg_amount")} መጠን: <b>${amount} ብር</b>\n` +
            `${e("msg_tid")} TID: <code>${tid}</code>\n` +
            `${e("msg_userid")} User ID: <code>${userId}</code>\n\n` +
            `🎉 <b>እንኳን ደስ አለዎት! የVIP አባልነትዎ ተጀምሯል።</b>\n\n` +
            `ከታች ያለውን <b>"VIP ቻናሉን ለመቀላቀል"</b> የሚለውን ቁልፍ በመጫን ቻናሎቹን ይቀላቀሉ:`;

          // 1. Remove the bottom reply keyboard
          await sendMessage(chatId, "🔐 <b>የVIP አባልነትዎ ነቅቷል!</b>", {
            parse_mode: "HTML",
            reply_markup: { remove_keyboard: true },
            botToken: token,
          });

          // 2. Send success message with the INLINE button below it
          await sendMessage(chatId, successMsg, {
            parse_mode: "HTML",
            protect_content: true,
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "🚪 VIP ቻናሉን ለመቀላቀል",
                    url: BOT_CONFIG.vipLink,
                    icon_custom_emoji_id: e_id("vip_door"),
                  },
                ],
              ],
            },
            botToken: token,
          });

          // 5. Notify Admins
          for (const adminId of BOT_CONFIG.adminIds) {
            try {
              await sendMessage(
                adminId,
                `${e("bell")} <b>አዲስ ክፍያ ተረጋግጧል!</b>\n\n` +
                `👤 User: <b>${fullName}</b> (@${username})\n` +
                `🆔 User ID: <code>${userId}</code>\n` +
                `🏦 Bank: <b>${bankName}</b>\n` +
                `💵 Amount: <b>${amount} ETB</b>\n` +
                `🔢 TID: <code>${tid}</code>`,
                { parse_mode: "HTML", botToken: token }
              );
            } catch (err) {
              console.warn(`Notify admin ${adminId} error:`, err);
            }
          }

          return NextResponse.json({ ok: true });
        } else {
          // Verification failed
          await sendMessage(
            chatId,
            `${e("error")} <b>ደረሰኙ አልተረጋገጠም</b>\n\n${verification.error || "የተላከው መረጃ ትክክለኛ የክፍያ ደረሰኝ አይደለም።"}\n\n` +
            `${e("bell")} ችግር ካጋጠመዎት ➡️ ${BOT_CONFIG.supportContact} ያናግሩን።`,
            {
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [
                  [{ text: "እንደገና ሞክር", callback_data: "buy_vip", icon_custom_emoji_id: e_id("back") }],
                ],
              },
              botToken: token,
            }
          );
          return NextResponse.json({ ok: true });
        }
      }

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("Telegram webhook error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    status: "online",
    bot: BOT_CONFIG.botUsername,
    message: "Wonde VIP Telegram Webhook is active and running on Vercel.",
  });
}
