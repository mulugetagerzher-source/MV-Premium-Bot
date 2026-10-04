# Wonde VIP Telegram Bot & Admin Dashboard (Vercel Serverless)

A full-stack, 100% serverless solution for running an automated Telegram VIP subscription bot with Ethiopian bank verification and real-time management dashboard on **Vercel**.

## 🌟 Architecture (No 24/7 PC, No Render Needed)

- **Telegram Webhook**: Serverless API route (`/api/telegram/webhook`) handles all user actions, package purchases, and automated receipt verifications in <200ms.
- **Bank Verifier**: High-performance TypeScript parser (`lib/payments/receiptVerifier.ts`) for Telebirr, Commercial Bank of Ethiopia (CBE), Bank of Abyssinia (BOA), and Awash Bank via QR scanning (`jsQR`, `Jimp`) and direct HTTPS endpoints.
- **Database**: Cloud PostgreSQL via **Supabase** (`users` & `payments` tables).
- **Vercel Cron**: Scheduled daily job (`/api/cron/cleanup`) to check expired VIP subscriptions and notify users automatically.
- **Admin Dashboard**: Real-time Next.js web application for manual approval, stats, and VIP toggles.

---

## 🚀 Deployment Instructions on Vercel

### Step 1: Import Project on Vercel
1. Log in to [vercel.com](https://vercel.com).
2. Click **Add New Project** → Import `mulugetagerzher-source/MV-Premium-Bot`.
3. Set **Root Directory** to: `admin-web`.
4. Leave **Framework Preset** as: `Next.js`.

### Step 2: Configure Environment Variables
Add the following Environment Variables in Vercel Project Settings:

| Variable | Description | Example / Value |
|---|---|---|
| `BOT_TOKEN` | Telegram Bot Token | `7985684671:AAEcSfiefPBCZKPt_nobuuv3_brX4rgAWcA` |
| `BOT_USERNAME` | Bot Username (without @) | `VIP_Police_bot` |
| `ADMIN_ID` | Comma-separated Admin IDs | `8614122635,6836013336` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL | `https://mqsrqoxhofojoziokgce.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Anon Key | *(Your anon key from .env)* |
| `SUPABASE_KEY` | Supabase Service Role Key | *(Your service_role key from .env)* |
| `TELEBIRR_NUMBER` | Telebirr receiver number | `0931069974` |
| `CBE_ACCOUNT` | Commercial Bank of Ethiopia Account | `1000726335277` |
| `ABYSSINIA_ACCOUNT` | Bank of Abyssinia Account | `75659105` |
| `AWASH_ACCOUNT` | Awash Bank Account | `01320557843000` |
| `ACCOUNT_NAME` | Receiver Account Name | `Wonde Gibo Ado, Mulugeta Gebregzabher Gebrekrstos` |
| `SUPPORT_CONTACT` | Telegram Support Handle | `@wolde_28` |
| `VIP_LINK` | Invite link to VIP Channel/Folder | `https://t.me/addlist/5jSQcywQEv44MjQ0` |
| `NEXT_PUBLIC_APP_URL` | Your live Vercel domain | `https://your-project-name.vercel.app` |

### Step 3: Connect Telegram Webhook (1 Click)
Once the deployment finishes:
1. Open your browser and navigate to:
   ```
   https://your-project-name.vercel.app/api/telegram/setup
   ```
   *(Or click the **⚡ Sync Telegram Webhook** button at the top of your Admin Web Dashboard).*
2. Telegram will respond:
   ```json
   {
     "ok": true,
     "bot": "VIP_Police_bot",
     "webhookUrl": "https://your-project-name.vercel.app/api/telegram/webhook",
     "message": "Webhook successfully registered with Telegram! The bot is now live on Vercel."
   }
   ```

**Your bot is now 100% online 24/7 on Vercel without requiring your computer to stay on!**
