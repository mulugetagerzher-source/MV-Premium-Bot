import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
import { setWebhook, setMyCommands } from "@/lib/telegram/bot";
import { BOT_CONFIG } from "@/lib/config";

const COMMANDS = [
  { command: "start", description: "VIP ቻናሎችን ለመቀላቀል / Start bot" },
];

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const host = request.headers.get("host");
    const proto = request.headers.get("x-forwarded-proto") || "https";
    
    // Automatically infer deployment URL or use query param / env
    const appUrl =
      searchParams.get("url") ||
      process.env.NEXT_PUBLIC_APP_URL ||
      `${proto}://${host}`;

    const normalizedUrl = appUrl.endsWith("/") ? appUrl : `${appUrl}/`;
    const webhookUrl = `${normalizedUrl}api/telegram/webhook`;
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET || "wonde_vip_secret";

    const webhookResult = await setWebhook(webhookUrl, secret, BOT_CONFIG.botToken);
    const commandsResult = await setMyCommands(COMMANDS, BOT_CONFIG.botToken);

    return NextResponse.json({
      ok: true,
      bot: BOT_CONFIG.botUsername,
      webhookUrl,
      webhookResult,
      commandsResult,
      message: "Webhook successfully registered with Telegram! The bot is now live on Vercel.",
    });
  } catch (error: any) {
    console.error("Setup error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
