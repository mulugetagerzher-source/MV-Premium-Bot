// Telegram Premium Custom Emoji Registry for Wonde VIP Bot

export const EMOJI_REGISTRY: Record<string, [string, string]> = {
  // Success message headers & labels
  msg_tele:     ["5348323259593014362", "💬"],
  msg_payer:    ["5348389475103816844", "✅"],
  msg_phone:    ["5897488197650223178", "📞"],
  msg_amount:   ["5447579253723918909", "💲"],
  msg_tid:      ["5814550759961793482", "👤"],
  msg_userid:   ["5256143829672672750", "👤"],

  // Custom branded icons
  wave:         ["5834660359482380973", "👋"],
  down_arrow:   ["5444961234933806330", "⬇️"],
  vip_door:     ["5447434637880098257", "🚪"],
  wallet:       ["5970068824215526931", "👛"],
  dollar:       ["5447579253723918909", "💲"],
  cbe:          ["5961054379350955385", "🏦"],
  abyssinia:    ["5796691581570393265", "🏦"],
  telebirr:     ["5960632377339285724", "📱"],
  paid_check:   ["5971800769777639477", "✅"],
  smile:        ["6214973911042361182", "😃"],
  green_check:  ["6190333464621879879", "✅"],
  warning_sign: ["5447381715293074599", "⚠️"],
  trash:        ["5445005936953424165", "🗑"],
  processing:   ["5445385947069838800", "🔲"],
  black_circle: ["5447429226221303478", "⚫"],
  trophy:       ["6266973397922616654", "🏆"],
  new_badge:    ["5834631553136726336", "🆕"],
  pkg_check:    ["6053202116707622090", "✔️"],
  back:         ["5967446600652430309", "◀️"],
  cancel:       ["5974083768233760323", "🔴"],

  // Other standard fallbacks
  star:         ["5346269127059196142", "🌟"],
  bell:         ["5346269127059196142", "🔔"],
  arrow_right:  ["5346269127059196142", "➡️"],
  error:        ["5346269127059196142", "❌"],
};

const PLACEHOLDER_ID = "5346269127059196142";

/**
 * Returns HTML tag with custom premium emoji for message texts
 * Requires parse_mode='HTML'
 */
export function e(key: string): string {
  const item = EMOJI_REGISTRY[key];
  if (!item) return "";
  const [eid, fallback] = item;
  if (eid === PLACEHOLDER_ID) return fallback;
  return `<tg-emoji emoji-id="${eid}">${fallback}</tg-emoji>`;
}

/**
 * Returns custom emoji ID for inline keyboard buttons
 * parameter: icon_custom_emoji_id
 */
export function e_id(key: string): string | undefined {
  const item = EMOJI_REGISTRY[key];
  if (!item) return undefined;
  const [eid] = item;
  return eid === PLACEHOLDER_ID ? undefined : eid;
}
