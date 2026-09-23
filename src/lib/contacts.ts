export type ImportedPhone = {
  label: string;
  value: string;
  normalized: string;
};

export type ImportedEmail = {
  label: string;
  value: string;
};

export type NormalizedImportedContact = {
  name: string;
  phones: ImportedPhone[];
  emails: ImportedEmail[];
  aliases: string[];
  notes: string | null;
  source: "phone_import" | "contact_picker";
  sourceUid: string;
};

function cleanText(value: string) {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

export function normalizeContactKey(value: string) {
  return cleanText(String(value || ""))
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}+]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function contactQueryVariants(value: string) {
  const base = normalizeContactKey(value);
  const variants = new Set<string>([base]);

  const words = base.split(" ").filter(Boolean);
  if (words.length === 1) {
    const word = words[0];
    const fixed: Record<string,string> = {
      "маме":"мама","маму":"мама","мамой":"мама",
      "папе":"папа","папу":"папа","папой":"папа",
      "сестре":"сестра","сестру":"сестра",
      "брату":"брат","бухгалтеру":"бухгалтер",
    };
    if (fixed[word]) variants.add(fixed[word]);
    if (word.length > 4 && /[ую]$/.test(word)) variants.add(word.slice(0,-1));
    if (word.length > 4 && /е$/.test(word)) variants.add(word.slice(0,-1) + "а");
  }

  return [...variants].filter(Boolean);
}

export function normalizePhone(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const hasPlus = raw.startsWith("+");
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) digits = "7" + digits.slice(1);
  if (digits.length === 11 && digits.startsWith("7")) return "+" + digits;
  if (hasPlus && digits) return "+" + digits;
  return digits;
}

function labelFromParams(params: string) {
  const upper = params.toUpperCase();
  if (upper.includes("CELL") || upper.includes("MOBILE")) return "мобильный";
  if (upper.includes("WORK")) return "рабочий";
  if (upper.includes("HOME")) return "домашний";
  if (upper.includes("FAX")) return "факс";
  return "основной";
}

function stableHash(value: string) {
  // Two 32-bit hashes avoid BigInt/crypto dependencies and keep VCF parsing synchronous.
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  const bytes = new TextEncoder().encode(value);
  for (const byte of bytes) {
    a = Math.imul(a ^ byte, 0x01000193) >>> 0;
    b = Math.imul(b ^ (byte + 0x51), 0x85ebca6b) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

function fingerprint(name: string, phones: ImportedPhone[], emails: ImportedEmail[]) {
  return stableHash(JSON.stringify({
    name: normalizeContactKey(name),
    phones: [...new Set(phones.map((item) => item.normalized).filter(Boolean))].sort(),
    emails: [...new Set(emails.map((item) => item.value.toLocaleLowerCase("en-US")).filter(Boolean))].sort(),
  }));
}

function unfoldVCard(input: string) {
  const source = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = source.split("\n");
  const unfolded: string[] = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && unfolded.length) unfolded[unfolded.length - 1] += line.slice(1);
    else unfolded.push(line);
  }
  return unfolded;
}

function displayNameFromN(value: string) {
  const parts = value.split(";").map(cleanText);
  const family = parts[0] || "";
  const given = parts[1] || "";
  const middle = parts[2] || "";
  return [given,middle,family].filter(Boolean).join(" ").trim();
}

export function parseVCard(input: string): NormalizedImportedContact[] {
  const lines = unfoldVCard(input);
  const cards: string[][] = [];
  let current: string[] | null = null;

  for (const line of lines) {
    if (/^BEGIN:VCARD$/i.test(line.trim())) {
      current = [];
      continue;
    }
    if (/^END:VCARD$/i.test(line.trim())) {
      if (current) cards.push(current);
      current = null;
      continue;
    }
    if (current) current.push(line);
  }

  const result: NormalizedImportedContact[] = [];

  for (const card of cards) {
    let name = "";
    let fallbackName = "";
    let notes: string | null = null;
    const phones: ImportedPhone[] = [];
    const emails: ImportedEmail[] = [];
    const aliases = new Set<string>();

    for (const line of card) {
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const head = line.slice(0, colon);
      const value = cleanText(line.slice(colon + 1));
      const [rawKey, ...params] = head.split(";");
      const key = rawKey.toUpperCase();
      const paramText = params.join(";");

      if (key === "FN") name = value;
      else if (key === "N") fallbackName = displayNameFromN(value);
      else if (key === "TEL") {
        const normalized = normalizePhone(value);
        if (normalized) phones.push({ label: labelFromParams(paramText), value, normalized });
      } else if (key === "EMAIL") {
        const email = value.trim();
        if (email) emails.push({ label: labelFromParams(paramText), value: email });
      } else if (key === "NICKNAME") {
        value.split(",").map((item) => cleanText(item)).filter(Boolean).forEach((item) => aliases.add(item));
      } else if (key === "NOTE") {
        notes = value || null;
      }
    }

    name = name || fallbackName;
    if (!name) continue;

    const phoneMap = new Map<string,ImportedPhone>();
    for (const phone of phones) if (!phoneMap.has(phone.normalized)) phoneMap.set(phone.normalized, phone);
    const emailMap = new Map<string,ImportedEmail>();
    for (const email of emails) {
      const key = email.value.toLocaleLowerCase("en-US");
      if (!emailMap.has(key)) emailMap.set(key, email);
    }

    const dedupedPhones = [...phoneMap.values()];
    const dedupedEmails = [...emailMap.values()];
    result.push({
      name,
      phones: dedupedPhones,
      emails: dedupedEmails,
      aliases: [...aliases],
      notes,
      source: "phone_import",
      sourceUid: fingerprint(name, dedupedPhones, dedupedEmails),
    });
  }

  const unique = new Map<string,NormalizedImportedContact>();
  for (const contact of result) {
    if (!unique.has(contact.sourceUid)) unique.set(contact.sourceUid, contact);
  }
  return [...unique.values()];
}

export function normalizePickedContact(input: {
  name?: string[] | string;
  tel?: string[];
  email?: string[];
}): NormalizedImportedContact | null {
  const name = Array.isArray(input.name) ? input.name.find(Boolean) || "" : String(input.name || "");
  if (!name.trim()) return null;
  const phones = (input.tel || []).map((value) => ({
    label: "основной",
    value,
    normalized: normalizePhone(value),
  })).filter((item) => item.normalized);
  const emails = (input.email || []).map((value) => ({ label: "основной", value: String(value).trim() })).filter((item) => item.value);
  return {
    name: name.trim(),
    phones,
    emails,
    aliases: [],
    notes: null,
    source: "contact_picker",
    sourceUid: fingerprint(name, phones, emails),
  };
}

export function mergeImportedContact(
  incoming: NormalizedImportedContact,
  existing?: {
    phone_numbers?: ImportedPhone[] | null;
    emails?: ImportedEmail[] | null;
    aliases?: string[] | null;
    notes?: string | null;
  } | null,
) {
  const phoneMap = new Map<string,ImportedPhone>();
  for (const phone of [...(existing?.phone_numbers || []), ...incoming.phones]) {
    const normalized = normalizePhone(phone.normalized || phone.value);
    if (normalized && !phoneMap.has(normalized)) phoneMap.set(normalized, { ...phone, normalized });
  }
  const emailMap = new Map<string,ImportedEmail>();
  for (const email of [...(existing?.emails || []), ...incoming.emails]) {
    const key = email.value.toLocaleLowerCase("en-US");
    if (key && !emailMap.has(key)) emailMap.set(key, email);
  }
  return {
    ...incoming,
    phones: [...phoneMap.values()],
    emails: [...emailMap.values()],
    aliases: [...new Set([...(existing?.aliases || []), ...incoming.aliases].map((item) => item.trim()).filter(Boolean))],
    notes: incoming.notes || existing?.notes || null,
  };
}
