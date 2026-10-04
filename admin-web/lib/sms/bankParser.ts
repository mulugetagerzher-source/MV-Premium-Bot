export interface ParsedBankSms {
  isBankSms: boolean;
  bank: "telebirr" | "boa" | "dashen" | "cbe" | "unknown";
  direction: "credit" | "debit" | "unknown";
  txnReference: string;
  amount: number;
  senderName?: string;
  recipientName?: string;
  account?: string;
  rawText: string;
}

/**
 * Normalizes text by removing non-standard whitespaces and hidden characters.
 */
function cleanText(text: string): string {
  return (text || "")
    .replace(/\u200B/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parses numeric amount from text string like "400.00", "1,250.50", "400".
 */
function parseAmount(val: string): number {
  if (!val) return 0;
  const cleaned = val.replace(/,/g, "").trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * Robust multi-bank parser supporting Telebirr, Bank of Abyssinia (BOA), Dashen Bank, and CBE.
 */
export function parseBankSms(raw: string, fromSender = ""): ParsedBankSms {
  const text = cleanText(raw);
  const lower = text.toLowerCase();
  const lowerSender = (fromSender || "").toLowerCase();

  const result: ParsedBankSms = {
    isBankSms: false,
    bank: "unknown",
    direction: "unknown",
    txnReference: "",
    amount: 0,
    rawText: raw,
  };

  // Reject non-bank phone notifications (Telegram store alerts, screenshot tools, etc.)
  if (
    lowerSender.includes("org.telegram") ||
    lower.includes("org.telegram") ||
    lower.includes("new purchase request") ||
    lower.includes("smartcapture") ||
    lowerSender.includes("smartcapture")
  ) {
    return result;
  }

  // 1. Detect Bank
  if (
    lowerSender.includes("telebirr") ||
    lowerSender.includes("127") ||
    lower.includes("telebirr") ||
    lower.includes("ethio telecom")
  ) {
    result.bank = "telebirr";
  } else if (
    lowerSender.includes("boa") ||
    lowerSender.includes("abyssinia") ||
    lower.includes("abyssinia") ||
    lower.includes("boa")
  ) {
    result.bank = "boa";
  } else if (
    lowerSender.includes("dashen") ||
    lowerSender.includes("db") ||
    lower.includes("dashen") ||
    lower.includes("db super app") ||
    lower.includes("db superapp") ||
    lower.includes("dbsuperapp")
  ) {
    result.bank = "dashen";
  } else if (
    lowerSender.includes("cbe") ||
    lower.includes("commercial bank of ethiopia") ||
    lower.includes("cbebirr") ||
    lower.includes("cbe birr")
  ) {
    result.bank = "cbe";
  }

  // 2. Extract Transaction Reference
  // 2a. Telebirr receipt URL: https://transactioninfo.ethiotelecom.et/receipt/DIS489S2JI or DIT...
  const receiptUrlMatch = text.match(
    /(?:transactioninfo\.ethiotelecom\.et\/receipt\/|ethiotelecom\.et\/receipt\/)([A-Za-z0-9_-]{6,30})/i
  );

  // 2b. Bank of Abyssinia slip URL: https://cs.bankofabyssinia.com/slip/?trx=FT26257R7FMQ68558
  const boaSlipMatch = text.match(
    /(?:bankofabyssinia\.com\/slip\/\?trx=)([A-Za-z0-9_-]{6,30})/i
  );

  // 2c. Telebirr / General: "Your transaction number is DIS489S2JI" or "DIT58WD42L"
  const telebirrRefMatch = text.match(
    /(?:(?:your\s+)?transaction\s*(?:number|id|no\.?|code)|txn\s*(?:id|ref|no\.?)|(?:የግብይት|የትራንዛክሽን)\s*(?:ቁጥር|መለያ)(?:ዎ)?)\s*(?:is|:|：|-)?\s*([A-Za-z0-9_-]{6,30})/i
  );

  // 2d. Bank of Abyssinia / Dashen / CBE: "Txn Ref: FT24098...", "Ref No: ...", "Ref is: ...", "Receipt No: ..."
  const bankRefMatch = text.match(
    /(?:txn\s*ref\b|reference\b(?:\s*no\.?|\s*number)?|ref\b(?:\s*no\.?|\s*number)?|receipt\s*no\.?)\s*(?:is|:|：|-)?\s*([A-Za-z0-9_-]{6,30})/i
  );

  // 2e. Standalone FT reference (e.g. FT24098ABC or FT24...)
  const ftRefMatch = text.match(/\b(FT[0-9A-Za-z]{8,24})\b/);

  // 2f. Standalone Telebirr reference (e.g. DJ34DYMMFS, DIS489S2JI, DIT58WD42L, DI8192019)
  const telebirrStandaloneMatch = text.match(/\b(D[A-Za-z0-9]{7,15})\b/);

  if (receiptUrlMatch && receiptUrlMatch[1]) {
    result.txnReference = receiptUrlMatch[1].trim();
  } else if (boaSlipMatch && boaSlipMatch[1]) {
    result.txnReference = boaSlipMatch[1].trim();
  } else if (telebirrRefMatch && telebirrRefMatch[1]) {
    result.txnReference = telebirrRefMatch[1].trim();
  } else if (bankRefMatch && bankRefMatch[1]) {
    result.txnReference = bankRefMatch[1].trim();
  } else if (ftRefMatch && ftRefMatch[1]) {
    result.txnReference = ftRefMatch[1].trim();
  } else if (telebirrStandaloneMatch && telebirrStandaloneMatch[1]) {
    result.txnReference = telebirrStandaloneMatch[1].trim();
  }


  // Sanity check: ensure reference is not a common English stopword (e.g. "erence", "reference")
  if (
    result.txnReference &&
    /^(?:erence|reference|number|amount|birr|etb|is|the|your|from|to|click)$/i.test(result.txnReference)
  ) {
    result.txnReference = "";
  }

  // If no label found but user pasted a clean 8-24 alphanumeric reference code (e.g. CC123456789 or 1028374829)
  if (!result.txnReference) {
    const standaloneMatch = text.match(/^[A-Za-z0-9_-]{8,24}$/);
    if (standaloneMatch) {
      result.txnReference = standaloneMatch[0].trim();
    }
  }

  // Infer bank from reference prefix if still unknown
  if (result.bank === "unknown" && result.txnReference) {
    if (/^(?:DIS|DIT)/i.test(result.txnReference)) {
      result.bank = "telebirr";
    } else if (/^FT/i.test(result.txnReference)) {
      result.bank = "boa";
    } else if (/^DS/i.test(result.txnReference)) {
      result.bank = "dashen";
    }
  }

  // 3. Extract Amount
  // Matches "400.00 ETB", "ETB 400.00", "credited with ETB 400.00", "transferred 400 ETB", "400 Birr"
  const amountPatterns = [
    /(?:received|transferred|credited\s*with|credited|deposited|amount|paid|ለማስተላለፍ|ገቢ\s*ተደርጓል)\s*(?:ETB|Birr)?\s*([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:ETB|Birr)?/i,
    /(?:ETB|Birr)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
    /([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:ETB|Birr)\b/i,
  ];

  for (const pattern of amountPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const parsed = parseAmount(match[1]);
      if (parsed > 0) {
        result.amount = parsed;
        break;
      }
    }
  }

  // 4. Extract Sender / Payer Name if available
  // e.g. "from NAHOM MEKUANINT" or "from ABEBE K."
  const senderMatch = text.match(
    /(?:from|በ\s*|ከ)\s+([A-Za-z\u1200-\u137F\s.]+?)(?:\s*\(\d+\)|\.|\s+Transaction|\s+Txn|\s+on\s+\d|\s+Your|\s+Current)/i
  );
  if (senderMatch && senderMatch[1]) {
    result.senderName = senderMatch[1].trim();
  }

  // 5. Extract Recipient Name if available
  // e.g. "transferred ... to NAHOM MEKUANINT (2519...)"
  const recipientMatch = text.match(
    /(?:to|ለ)\s+([A-Za-z\u1200-\u137F\s.]+?)(?:\s*\([0-9*]+\)|\s*\(\d+\)|\.|\s+Transaction|\s+Txn|\s+on\s+\d|\s+Your)/i
  );
  if (recipientMatch && recipientMatch[1]) {
    const candidateName = recipientMatch[1].trim();
    if (!/^(?:download|view|see|pay|check|the)\b/i.test(candidateName)) {
      result.recipientName = candidateName;
    }
  }

  // 5b. Extract Account / Phone Number if present in parentheses or labeled
  const accMatch = text.match(/\(([0-9*]{8,18})\)/) || text.match(/(?:account|acc\.?|phone|no\.?)\s*(?:is|:|：|-)?\s*([0-9*]{8,18})/i);
  if (accMatch && accMatch[1]) {
    result.account = accMatch[1].trim();
  }

  // 6. Detect Direction (Credit / Incoming vs Debit / Outgoing)
  const isDebit =
    /you have transferred/i.test(text) ||
    /debited with/i.test(text) ||
    /was debited/i.test(text) ||
    /is debited/i.test(text) ||
    /you have paid/i.test(text) ||
    /bought airtime/i.test(text) ||
    /service fee/i.test(text) ||
    /(?:ወጪ\s*ሆኗል|ወጪ\s*ተደርጓል|አስተላልፈዋል|ተቀንሷል|ከሂሳብዎ\s*ቀንሷል)/i.test(text);

  const isCredit =
    /you have received/i.test(text) ||
    /received\s+ETB/i.test(text) ||
    /credited with/i.test(text) ||
    /was credited/i.test(text) ||
    /is credited/i.test(text) ||
    /deposited/i.test(text) ||
    /(?:ገቢ\s*ሆኗል|ገቢ\s*ተደርጓል|ተቀብለዋል)/i.test(text);

  if (isDebit && !isCredit) {
    result.direction = "debit";
  } else if (isCredit && !isDebit) {
    result.direction = "credit";
  } else if (isCredit && isDebit) {
    if (
      /you have transferred/i.test(text) ||
      /debited with/i.test(text) ||
      /is debited/i.test(text) ||
      /was debited/i.test(text)
    ) {
      result.direction = "debit";
    } else {
      result.direction = "credit";
    }
  } else {
    result.direction = "unknown";
  }

  // Determine if this is a legitimate bank payment notification
  if (result.txnReference && (result.amount > 0 || result.bank !== "unknown")) {
    result.isBankSms = true;
  }

  return result;
}
