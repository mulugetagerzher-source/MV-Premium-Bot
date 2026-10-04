import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
import { createSupabaseAdmin } from "@/lib/supabase";
import { BOT_CONFIG, isAdminUser } from "@/lib/config";
import {
  sendMessage,
  editMessageText,
  answerCallbackQuery,
  getFile,
} from "@/lib/telegram/bot";
import { verifyPayment } from "@/lib/payments/receiptVerifier";
import { parseBankSms } from "@/lib/sms/bankParser";

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

export async function POST(req: NextRequest) {
  try {
    const update = await req.json();
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
          `ሰላም ${fullName} 👋\n\nወደ <b>Wonde VIP</b> ቦት እንኳን ደህና መጡ።\n\nሁሉንም የቪአይፒ ቻናሎች ለመቀላቀል ከታች ያለውን በተን ይጫኑ።`,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: "🚪 VIP ቻናሉን ለመቀላቀል", callback_data: "buy_vip" }],
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
          `👇 የሚፈልጉትን ይምረጡ:`,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: "💳 Deposit (መክፈል)", callback_data: "make_deposit" }],
                [{ text: "ℹ️ ስለ VIP ቻናሎቻችን ለማወቅ", callback_data: "vip_info" }],
                [{ text: "🔴 Cancel Order", callback_data: "cancel_order" }],
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
          `🌟 <b>Wonde VIP Channels Info</b>\n\n• ዕለታዊ የቪአይፒ መረጃዎችና አዳዲስ ጥቆማዎች\n• 49+ ፕሪሚየም ቻናሎችን በአንድ ሊንክ ያገኛሉ\n• ፈጣንና አስተማማኝ አውቶማቲክ አሰራር\n\nእርዳታ ከፈለጉ ➡️ ${BOT_CONFIG.supportContact}`,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: "💳 አሁን ክፈል (Deposit)", callback_data: "make_deposit" }],
                [{ text: "◀️ Back", callback_data: "buy_vip" }],
              ],
            },
            botToken: token,
          }
        );
        return NextResponse.json({ ok: true });
      }

      // Action: make_deposit -> Show packages
      if (data === "make_deposit") {
        const pkgButtons = Object.values(BOT_CONFIG.packages).map((pkg) => [
          { text: `✔️ ${pkg.label}`, callback_data: `pkg_${pkg.key}` },
        ]);
        pkgButtons.push([
          { text: "◀️ Back", callback_data: "buy_vip" },
          { text: "🔴 Cancel Order", callback_data: "cancel_order" },
        ]);

        await editMessageText(
          chatId,
          messageId,
          `💵 ከታች ከተዘረዘሩት ጥቅሎች የሚፈልጉትን ይምረጡ:`,
          {
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: pkgButtons },
            botToken: token,
          }
        );
        return NextResponse.json({ ok: true });
      }

      // Action: Select Package -> Show Payment Methods
      if (data.startsWith("pkg_")) {
        const pkgKey = data.replace("pkg_", "");
        const pkg = BOT_CONFIG.packages[pkgKey] || BOT_CONFIG.packages["1month"];

        await editMessageText(
          chatId,
          messageId,
          `📦 <b>ጥቅል ተመርጧል:</b> ${pkg.label} (${pkg.price} ብር)\n\n💳 የክፍያ ዘዴ ይምረጡ:`,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: "📱 Telebirr", callback_data: `pay_tele_${pkgKey}` }],
                [{ text: "🏦 CBE Birr", callback_data: `pay_cbe_${pkgKey}` }],
                [{ text: "🏦 Bank of Abyssinia", callback_data: `pay_boa_${pkgKey}` }],
                [{ text: "🏦 Awash Bank", callback_data: `pay_awash_${pkgKey}` }],
                [
                  { text: "◀️ Back", callback_data: "make_deposit" },
                  { text: "🔴 Cancel", callback_data: "cancel_order" },
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

        let title = "📱 <b>Telebirr</b>";
        let acct = `ቁጥር: <code>${BOT_CONFIG.telebirrNumber}</code>`;
        let tip = `ከከፈሉ በኋላ የደረሰኝ ስክሪንሾት ወይም TID (ምሳሌ: <code>CD68C1BD7V</code>) ለቦቱ ይላኩ።`;

        if (method === "cbe") {
          title = "🏦 <b>CBE Birr</b>";
          acct = `Account: <code>${BOT_CONFIG.cbeAccount}</code>`;
          tip = `ከከፈሉ በኋላ የደረሰኝ ሊንክ ወይም ስክሪንሾት ይላኩ (ምሳሌ: <code>https://mbreciept.cbe.com.et/...</code>)`;
        } else if (method === "boa") {
          title = "🏦 <b>Bank of Abyssinia</b>";
          acct = `Account: <code>${BOT_CONFIG.abyssiniaAccount}</code>`;
          tip = `ከከፈሉ በኋላ የደረሰኝ ሊንክ ወይም ስክሪንሾት ይላኩ (ምሳሌ: <code>https://cs.bankofabyssinia.com/slip/?trx=...</code>)`;
        } else if (method === "awash") {
          title = "🏦 <b>Awash Bank</b>";
          acct = `Account: <code>${BOT_CONFIG.awashAccount}</code>`;
          tip = `ከከፈሉ በኋላ የደረሰኝ ሊንክ ወይም ስክሪንሾት ይላኩ።`;
        }

        const msg =
          `${title}\n\n` +
          `${acct}\n` +
          `ስም ➡️ <b>${BOT_CONFIG.accountName}</b>\n\n` +
          `💵 ሊከፍሉ ያለው: <b>${pkg.price} ብር</b>\n\n` +
          `✅ ${tip}\n\n` +
          `🔔 ለተጨማሪ መረጃ ➡️ ${BOT_CONFIG.supportContact}`;

        await editMessageText(chatId, messageId, msg, {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "✅ ከፍያለሁ (Send Receipt)", callback_data: `confirm_${method}_${pkgKey}` }],
              [{ text: "◀️ Back", callback_data: `pkg_${pkgKey}` }],
            ],
          },
          botToken: token,
        });
        return NextResponse.json({ ok: true });
      }

      // Action: Confirm Prompt
      if (data.startsWith("confirm_")) {
        await editMessageText(
          chatId,
          messageId,
          `📩 እባክዎ አሁን የደረሰኙን ስክሪንሾት (Screenshot) ወይም የትራንዛክሽን ቁጥር (TID / SMS) ይላኩ።\n\nቦቱ አውቶማቲክ አረጋግጦ የቪአይፒ ሊንኩን ይሰጥዎታል።`,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: "🔴 Cancel", callback_data: "cancel_order" }],
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
    // 2. MESSAGES (Text, Photo, Commands)
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
          `ሰላም <b>${fullName}</b> 👋\n\nወደ <b>Wonde VIP</b> ቦት እንኳን ደህና መጡ።\n\nሁሉንም የቪአይፒ ቻናሎች ለመቀላቀል ከታች ያለውን በተን ይጫኑ።`,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: "🚪 VIP ቻናሉን ለመቀላቀል", callback_data: "buy_vip" }],
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
        // Processing message
        const procMsg = await sendMessage(
          chatId,
          `⏳ ደረሰኙን በማረጋገጥ ላይ ነኝ... እባክዎ ትንሽ ይጠብቁ።`,
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
                senderName: parsedSms.senderName || fullName,
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
          const payerName = verification.senderName || fullName;
          const bankName = verification.bank.toUpperCase();

          // 1. Check duplicate payment in Supabase
          const { data: existingPayment } = await supabase
            .from("payments")
            .select("id")
            .eq("transaction_id", tid)
            .maybeSingle();

          if (existingPayment) {
            await sendMessage(
              chatId,
              `❌ <b>ትራንዛክሽን ቁጥሩ አስቀድሞ ጥቅም ላይ ውሏል!</b>\nእባክዎ ትክክለኛ አዲስ ቁጥር ይላኩ።`,
              { parse_mode: "HTML", botToken: token }
            );
            return NextResponse.json({ ok: true });
          }

          // 2. Save payment to Supabase
          await supabase.from("payments").insert({
            user_id: userId,
            payer_name: payerName,
            phone: verification.senderPhone || "None",
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

          // 4. Send Success and VIP Link
          const successMsg =
            `✅ <b>ክፍያዎ ተረጋግጧል!</b>\n\n` +
            `🏦 የክፍያ ዘዴ: <b>${bankName}</b>\n` +
            `👤 ከፋይ ስም: <b>${payerName}</b>\n` +
            `💵 መጠን: <b>${amount} ብር</b>\n` +
            `🆔 TID: <code>${tid}</code>\n` +
            `📅 ቆይታ: <b>${pkg.label}</b>\n\n` +
            `🌟 ጥያቄዎ ተቀባይነት አግኝቷል! ከታች ያለውን ሊንክ በመጫን የቪአይፒ ቻናሎችን ይቀላቀሉ።`;

          await sendMessage(chatId, successMsg, {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: "🚪 VIP ቻናሉን ለመቀላቀል", url: BOT_CONFIG.vipLink }],
              ],
            },
            botToken: token,
          });

          // 5. Notify Admins
          for (const adminId of BOT_CONFIG.adminIds) {
            try {
              await sendMessage(
                adminId,
                `🔔 <b>አዲስ ክፍያ ተረጋግጧል!</b>\n\n` +
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
            `❌ <b>ደረሰኙ አልተረጋገጠም</b>\n\n${verification.error || "የተላከው መረጃ ትክክለኛ የክፍያ ደረሰኝ አይደለም።"}\n\n` +
            `🔔 ችግር ካጋጠመዎት ➡️ ${BOT_CONFIG.supportContact} ያናግሩን።`,
            {
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [
                  [{ text: "◀️ እንደገና ሞክር", callback_data: "buy_vip" }],
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
