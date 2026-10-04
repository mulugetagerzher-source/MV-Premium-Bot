// Configuration for Wonde VIP Telegram Bot

export const BOT_CONFIG = {
  botToken: process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "7985684671:AAEcSfiefPBCZKPt_nobuuv3_brX4rgAWcA",
  botUsername: (process.env.BOT_USERNAME || "VIP_Police_bot").replace(/^@/, ""),
  
  // Admin IDs
  adminIds: (process.env.ADMIN_ID || "8614122635,6836013336")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
  
  // Banking & Payment Details
  accountName: process.env.ACCOUNT_NAME || "Wonde Gibo Ado, Mulugeta Gebregzabher Gebrekrstos",
  telebirrNumber: process.env.TELEBIRR_NUMBER || "0931069974",
  cbeAccount: process.env.CBE_ACCOUNT || "1000726335277",
  abyssiniaAccount: process.env.ABYSSINIA_ACCOUNT || "75659105",
  awashAccount: process.env.AWASH_ACCOUNT || "01320557843000",
  
  // Support & VIP link
  supportContact: process.env.SUPPORT_CONTACT || "@wolde_28",
  vipLink: process.env.VIP_LINK || "https://t.me/addlist/5jSQcywQEv44MjQ0",
  
  // Packages
  packages: {
    "1month": { key: "1month", label: "1 ወር 300 ብር", price: 300, days: 30 },
    "2month": { key: "2month", label: "2 ወር 600 ብር", price: 600, days: 60 },
    "3month": { key: "3month", label: "3 ወር 800 ብር", price: 800, days: 90 },
    "6month": { key: "6month", label: "6 ወር 1600 ብር", price: 1600, days: 180 },
    "1year":  { key: "1year",  label: "1 አመት 3000 ብር", price: 3000, days: 365 },
  } as Record<string, { key: string; label: string; price: number; days: number }>,

  // Channels to unban
  channels: [
    -1001987304596, -1001879981713, -1001908488600, -1001894307398, -1001886847332,
    -1001644520879, -1001228986551, -1001798057767, -1001785612472, -1001972355742,
    -1001872327091, -1001942531103, -1001672526790, -1001982664935, -1001682250265,
    -1001841610985, -1001933037611, -1001916522608, -1001923315234, -1001672417759,
    -1001904087061, -1001974239289, -1001978229621, -1001829943930, -1001604567537,
    -1001796161543, -1001977135210, -1001829347343, -1001921674082, -1001846971061,
    -1001960309825, -1001907677718, -1001937713508, -1001962490484, -1001889028743,
    -1001820656106, -1001705942123, -1001802800701, -1001715577856, -1001711316031,
    -1002114117328, -1001934660701, -1002030934045, -1001994830663, -1002097422043,
    -1001970922921, -1002071141228, -1002441690243, -1002234781880,
  ],
};

export function isAdminUser(userId: number | string): boolean {
  return BOT_CONFIG.adminIds.includes(String(userId));
}
