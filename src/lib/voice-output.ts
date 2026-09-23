export function isSensitiveSpeechText(value: string) {
  const text = String(value || "").toLocaleLowerCase("ru-RU");
  if (!text.trim()) return false;
  return [
    /парол/,
    /password/,
    /api[\s_-]*key/,
    /токен/,
    /token/,
    /секретн(?:ый|ая|ое|ые)?\s+ключ/,
    /cvv|cvc/,
    /номер\s+карт/,
    /банковск(?:ие|ий|ая)\s+реквизит/,
    /\biban\b|\bswift\b/,
    /полный\s+паспорт/,
    /паспортн(?:ые|ый|ая)\s+данн/,
    /снилс/,
  ].some((pattern) => pattern.test(text));
}

export function speechText(value: string, maxLength = 1800) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text || isSensitiveSpeechText(text)) return null;
  return text.slice(0, Math.max(1, maxLength));
}
