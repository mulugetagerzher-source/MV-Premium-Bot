const TELEGRAM_API = "https://api.telegram.org";

export function getBotToken(tokenOverride?: string): string {
  if (tokenOverride) return tokenOverride;
  return process.env.TELEGRAM_BOT_TOKEN || "";
}

export function getBackupBotToken(): string {
  return process.env.TELEGRAM_BACKUP_BOT_TOKEN || "";
}

export function getBackupBot2Token(): string {
  return process.env.TELEGRAM_BACKUP_BOT_2_TOKEN || process.env.TELEGRAM_TERTIARY_BOT_TOKEN || "";
}

export function getAllBackupBotTokens(): string[] {
  return [getBackupBotToken(), getBackupBot2Token()].filter((t) => Boolean(t && t.trim()));
}

export interface ActiveBotInfo {
  token: string;
  username: string;
  name: string;
}

let cachedActiveBot: { info: ActiveBotInfo; expiresAt: number } | null = null;

/**
 * Returns the currently active/healthy bot (Primary -> Backup 1 -> Backup 2).
 * Verifies availability via Telegram getMe with a 30s cache.
 */
export async function getActiveBotInfo(): Promise<ActiveBotInfo> {
  const now = Date.now();
  if (cachedActiveBot && cachedActiveBot.expiresAt > now) {
    return cachedActiveBot.info;
  }

  const primaryUsername = (process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || process.env.TELEGRAM_BOT_USERNAME || "pixelsrcsbot").replace(/^@/, "");
  const backup1Username = (process.env.NEXT_PUBLIC_TELEGRAM_BACKUP_BOT_USERNAME || process.env.TELEGRAM_BACKUP_BOT_USERNAME || "pixelsrcs1bot").replace(/^@/, "");
  const backup2Username = (process.env.NEXT_PUBLIC_TELEGRAM_BACKUP_BOT_2_USERNAME || process.env.TELEGRAM_BACKUP_BOT_2_USERNAME || "pixelsrcs2bot").replace(/^@/, "");

  const candidates = [
    { token: process.env.TELEGRAM_BOT_TOKEN || "", username: primaryUsername, name: "Primary Bot" },
    { token: process.env.TELEGRAM_BACKUP_BOT_TOKEN || "", username: backup1Username, name: "Backup Bot 1" },
    { token: process.env.TELEGRAM_BACKUP_BOT_2_TOKEN || process.env.TELEGRAM_TERTIARY_BOT_TOKEN || "", username: backup2Username, name: "Backup Bot 2" },
  ];

  for (const candidate of candidates) {
    if (!candidate.token) continue;
    try {
      const res = await fetch(`${TELEGRAM_API}/bot${candidate.token}/getMe`, { method: "POST" });
      const data = await res.json();
      if (data.ok && data.result?.username) {
        const info: ActiveBotInfo = {
          token: candidate.token,
          username: data.result.username.replace(/^@/, ""),
          name: candidate.name,
        };
        cachedActiveBot = { info, expiresAt: now + 30000 }; // 30s cache
        return info;
      }
    } catch {
      // Try next fallback bot
    }
  }

  // Fallback to configured primary
  const defaultInfo: ActiveBotInfo = candidates[0];
  return defaultInfo;
}

async function callTelegramApi(
  endpoint: string,
  payload: any,
  tokenOverride?: string,
  isFormData = false
) {
  const primaryToken = getBotToken(tokenOverride);
  const backupTokens = getAllBackupBotTokens();

  const makeRequest = async (token: string) => {
    if (!token) return { ok: false, description: "Missing bot token" };
    const url = `${TELEGRAM_API}/bot${token}/${endpoint}`;
    if (isFormData) {
      return fetch(url, { method: "POST", body: payload });
    }
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  };

  try {
    const res = await makeRequest(primaryToken);
    let data: any = null;
    try {
      data = await (res as Response).json();
    } catch {
      data = null;
    }

    // If primary failed due to token revocation (401), unauthorized, or network error,
    // and backup tokens are available, automatically retry through available backup bots
    const isUnauthorized = !res || (res as Response).status === 401 || (data && data.error_code === 401);
    if (isUnauthorized && backupTokens.length > 0) {
      for (const backupToken of backupTokens) {
        if (backupToken === primaryToken) continue;
        console.warn(`[Telegram Bot] Call to ${endpoint} with primary bot failed. Failing over to backup bot token...`);
        try {
          const backupRes = await makeRequest(backupToken);
          const backupData = await (backupRes as Response).json();
          if (backupData?.ok) return backupData;
        } catch {
          // Continue to next backup bot
        }
      }
      return { ok: false, description: "All backup bots failed" };
    }

    return data || { ok: false };
  } catch (err: any) {
    if (backupTokens.length > 0) {
      for (const backupToken of backupTokens) {
        if (backupToken === primaryToken) continue;
        console.warn(`[Telegram Bot] Call to ${endpoint} error (${err?.message}). Trying backup bot...`);
        try {
          const backupRes = await makeRequest(backupToken);
          const backupData = await (backupRes as Response).json();
          if (backupData?.ok) return backupData;
        } catch {
          // Continue to next backup bot
        }
      }
    }
    return { ok: false, description: err?.message || "Telegram request failed" };
  }
}

export async function sendMessage(
  chatId: number | string,
  text: string,
  options?: { reply_markup?: object; parse_mode?: string; botToken?: string }
) {
  return callTelegramApi(
    "sendMessage",
    {
      chat_id: chatId,
      text,
      parse_mode: options?.parse_mode ?? "HTML",
      reply_markup: options?.reply_markup,
    },
    options?.botToken
  );
}

export async function sendPhoto(
  chatId: number | string,
  photo: string,
  caption?: string,
  options?: { reply_markup?: object; parse_mode?: string; botToken?: string }
) {
  return callTelegramApi(
    "sendPhoto",
    {
      chat_id: chatId,
      photo,
      caption,
      parse_mode: options?.parse_mode ?? "HTML",
      reply_markup: options?.reply_markup,
    },
    options?.botToken
  );
}

export async function uploadPhotoFile(
  chatId: number | string,
  file: Blob | File,
  fileName?: string,
  caption?: string,
  botToken?: string
) {
  const formData = new FormData();
  formData.append("chat_id", String(chatId));
  if (fileName) {
    formData.append("photo", file, fileName);
  } else {
    formData.append("photo", file);
  }
  if (caption) {
    formData.append("caption", caption);
  }
  return callTelegramApi("sendPhoto", formData, botToken, true);
}

export async function uploadVideoFile(
  chatId: number | string,
  file: Blob | File,
  fileName?: string,
  caption?: string,
  botToken?: string
) {
  const formData = new FormData();
  formData.append("chat_id", String(chatId));
  if (fileName) {
    formData.append("video", file, fileName);
  } else {
    formData.append("video", file);
  }
  if (caption) {
    formData.append("caption", caption);
  }
  formData.append("supports_streaming", "true");
  return callTelegramApi("sendVideo", formData, botToken, true);
}

export async function sendDocument(
  chatId: number | string,
  document: string,
  caption?: string,
  botToken?: string,
  options?: { reply_markup?: object; parse_mode?: string }
) {
  return callTelegramApi(
    "sendDocument",
    {
      chat_id: chatId,
      document,
      caption,
      parse_mode: options?.parse_mode ?? "HTML",
      reply_markup: options?.reply_markup,
    },
    botToken
  );
}

export async function sendVideo(
  chatId: number | string,
  video: string,
  caption?: string,
  botToken?: string,
  options?: { reply_markup?: object; parse_mode?: string }
) {
  return callTelegramApi(
    "sendVideo",
    {
      chat_id: chatId,
      video,
      caption,
      parse_mode: options?.parse_mode ?? "HTML",
      reply_markup: options?.reply_markup,
    },
    botToken
  );
}

export async function forwardMessage(
  chatId: number | string,
  fromChatId: number | string,
  messageId: number,
  botToken?: string
) {
  return callTelegramApi(
    "forwardMessage",
    {
      chat_id: chatId,
      from_chat_id: fromChatId,
      message_id: messageId,
    },
    botToken
  );
}

export async function copyMessage(
  chatId: number | string,
  fromChatId: number | string,
  messageId: number,
  caption?: string,
  botToken?: string,
  options?: { reply_markup?: object; parse_mode?: string }
) {
  const payload: Record<string, any> = {
    chat_id: chatId,
    from_chat_id: fromChatId,
    message_id: messageId,
  };
  if (caption) {
    payload.caption = caption;
    payload.parse_mode = options?.parse_mode ?? "HTML";
  }
  if (options?.reply_markup) {
    payload.reply_markup = options.reply_markup;
  }
  return callTelegramApi("copyMessage", payload, botToken);
}

export async function setWebhook(url: string, secret: string, botToken?: string) {
  return callTelegramApi(
    "setWebhook",
    {
      url,
      secret_token: secret,
      allowed_updates: ["message", "callback_query", "channel_post", "inline_query", "chat_member"],
    },
    botToken
  );
}

export async function answerInlineQuery(
  inlineQueryId: string,
  results: any[],
  options?: { cache_time?: number; is_personal?: boolean; next_offset?: string },
  botToken?: string
) {
  return callTelegramApi(
    "answerInlineQuery",
    {
      inline_query_id: inlineQueryId,
      results,
      cache_time: options?.cache_time ?? 5,
      is_personal: options?.is_personal ?? true,
      next_offset: options?.next_offset,
    },
    botToken
  );
}

export async function getFile(fileId: string, botToken?: string) {
  return callTelegramApi("getFile", { file_id: fileId }, botToken);
}

export async function deleteMessage(
  chatId: number | string,
  messageId: number,
  botToken?: string
) {
  return callTelegramApi(
    "deleteMessage",
    { chat_id: chatId, message_id: messageId },
    botToken
  );
}

export async function editMessageText(
  chatId: number | string,
  messageId: number,
  text: string,
  options?: { reply_markup?: object; parse_mode?: string; botToken?: string }
) {
  return callTelegramApi(
    "editMessageText",
    {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: options?.parse_mode ?? "HTML",
      reply_markup: options?.reply_markup,
    },
    options?.botToken
  );
}

export async function editMessageCaption(
  chatId: number | string,
  messageId: number,
  caption: string,
  options?: { reply_markup?: object; parse_mode?: string; botToken?: string }
) {
  return callTelegramApi(
    "editMessageCaption",
    {
      chat_id: chatId,
      message_id: messageId,
      caption,
      parse_mode: options?.parse_mode ?? "HTML",
      reply_markup: options?.reply_markup,
    },
    options?.botToken
  );
}

export async function editMessageMedia(
  chatId: number | string,
  messageId: number,
  media: { type: string; media: string; caption?: string; parse_mode?: string },
  options?: { reply_markup?: object; botToken?: string }
) {
  return callTelegramApi(
    "editMessageMedia",
    {
      chat_id: chatId,
      message_id: messageId,
      media,
      reply_markup: options?.reply_markup,
    },
    options?.botToken
  );
}

export async function setChatMenuButton(
  chatId: number,
  menuButton: { type: string; web_app?: { url: string }; text?: string },
  botToken?: string
) {
  return callTelegramApi(
    "setChatMenuButton",
    {
      chat_id: chatId,
      menu_button: menuButton,
    },
    botToken
  );
}

export async function setChatMenuButtonGlobal(
  menuButton: { type: string; web_app?: { url: string }; text?: string },
  botToken?: string
) {
  return callTelegramApi(
    "setChatMenuButton",
    { menu_button: menuButton },
    botToken
  );
}

export async function deleteChatMenuButton(chatId: number, botToken?: string) {
  return callTelegramApi("deleteChatMenuButton", { chat_id: chatId }, botToken);
}

export async function getMyCommands(botToken?: string) {
  return callTelegramApi("getMyCommands", {}, botToken);
}

export async function sendReplyKeyboard(
  chatId: number | string,
  text: string,
  keyboard: (string | { text: string; web_app?: { url: string } })[][],
  options?: { resize_keyboard?: boolean; one_time_keyboard?: boolean; parse_mode?: string; botToken?: string }
) {
  return callTelegramApi(
    "sendMessage",
    {
      chat_id: chatId,
      text,
      parse_mode: options?.parse_mode ?? "HTML",
      reply_markup: {
        keyboard,
        resize_keyboard: options?.resize_keyboard ?? true,
        one_time_keyboard: options?.one_time_keyboard ?? false,
      },
    },
    options?.botToken
  );
}

export async function setMyCommands(
  commands: Array<{ command: string; description: string }>,
  botToken?: string
) {
  return callTelegramApi("setMyCommands", { commands }, botToken);
}

export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
  showAlert?: boolean,
  botToken?: string
) {
  return callTelegramApi(
    "answerCallbackQuery",
    {
      callback_query_id: callbackQueryId,
      text,
      show_alert: showAlert ?? false,
    },
    botToken
  );
}

export async function getChat(chatId: number | string, botToken?: string) {
  return callTelegramApi("getChat", { chat_id: chatId }, botToken);
}

export async function getChatMember(
  chatId: number | string,
  userId: number | string,
  botToken?: string
): Promise<{ ok: boolean; result?: { status: string }; description?: string; error_code?: number }> {
  return callTelegramApi("getChatMember", { chat_id: chatId, user_id: userId }, botToken);
}

export function isMemberStatus(status?: string): boolean {
  return ["creator", "administrator", "member", "restricted"].includes(status || "");
}

export async function banChatMember(
  chatId: number | string,
  userId: number | string,
  botToken?: string
) {
  return callTelegramApi(
    "banChatMember",
    { chat_id: chatId, user_id: userId },
    botToken
  );
}

export async function unbanChatMember(
  chatId: number | string,
  userId: number | string,
  botToken?: string
) {
  return callTelegramApi(
    "unbanChatMember",
    { chat_id: chatId, user_id: userId, only_if_banned: true },
    botToken
  );
}
