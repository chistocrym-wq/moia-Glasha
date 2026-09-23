"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  mergeImportedContact,
  normalizePhone,
  normalizePickedContact,
  parseVCard,
  type ImportedEmail,
  type ImportedPhone,
  type NormalizedImportedContact,
} from "@/lib/contacts";

type ExistingContact = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  phone_numbers: ImportedPhone[] | null;
  emails: ImportedEmail[] | null;
  aliases: string[] | null;
  notes: string | null;
  source: string;
  source_uid: string | null;
};

type ImportPlanItem = {
  incoming: NormalizedImportedContact;
  merged: NormalizedImportedContact;
  existingId: string | null;
  status: "new" | "merge" | "duplicate";
};

type PickerContact = {
  name?: string[];
  tel?: string[];
  email?: string[];
};

type ContactPickerNavigator = Navigator & {
  contacts?: {
    select: (
      properties: Array<"name" | "tel" | "email">,
      options?: { multiple?: boolean },
    ) => Promise<PickerContact[]>;
  };
};

function normalizedPhones(row: ExistingContact) {
  const rich = Array.isArray(row.phone_numbers) ? row.phone_numbers : [];
  const legacy = row.phone ? [{ label: "основной", value: row.phone, normalized: normalizePhone(row.phone) }] : [];
  return [...rich, ...legacy].map((item) => normalizePhone(item.normalized || item.value)).filter(Boolean);
}

function normalizedEmails(row: ExistingContact) {
  const rich = Array.isArray(row.emails) ? row.emails : [];
  const legacy = row.email ? [{ label: "основной", value: row.email }] : [];
  return [...rich, ...legacy].map((item) => item.value.toLocaleLowerCase("en-US")).filter(Boolean);
}

function comparable(contact: NormalizedImportedContact) {
  return JSON.stringify({
    phones: contact.phones.map((item) => item.normalized).sort(),
    emails: contact.emails.map((item) => item.value.toLocaleLowerCase("en-US")).sort(),
    aliases: [...contact.aliases].map((item) => item.toLocaleLowerCase("ru-RU")).sort(),
    notes: contact.notes || "",
  });
}

export default function PhonebookImport({
  liveData,
  onImported,
}: {
  liveData: boolean;
  onImported: () => Promise<void> | void;
}) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [plan, setPlan] = useState<ImportPlanItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [pickerSupported, setPickerSupported] = useState(false);

  useEffect(() => {
    setPickerSupported(Boolean((navigator as ContactPickerNavigator).contacts?.select));
  }, []);

  useEffect(() => {
    if (!liveData) {
      setPlan([]);
      setStatus("");
      if (fileRef.current) fileRef.current.value = "";
    }
  }, [liveData]);

  const counts = useMemo(() => ({
    total: plan.length,
    newCount: plan.filter((item) => item.status === "new").length,
    mergeCount: plan.filter((item) => item.status === "merge").length,
    duplicateCount: plan.filter((item) => item.status === "duplicate").length,
  }), [plan]);

  async function buildPlan(incoming: NormalizedImportedContact[]) {
    if (!supabase) throw new Error("Supabase не подключён.");
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) throw new Error("Нужно войти в Глашу.");

    const existing: ExistingContact[] = [];
    const pageSize = 1000;
    for (let offset = 0; offset < 10000; offset += pageSize) {
      const { data, error } = await supabase
        .from("contacts")
        .select("id,name,phone,email,phone_numbers,emails,aliases,notes,source,source_uid")
        .eq("user_id", auth.user.id)
        .order("id")
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      const page = (data ?? []) as ExistingContact[];
      existing.push(...page);
      if (page.length < pageSize) break;
    }
    const byUid = new Map(existing.filter((row) => row.source_uid).map((row) => [String(row.source_uid), row]));
    const byPhone = new Map<string,ExistingContact>();
    const byEmail = new Map<string,ExistingContact>();
    for (const row of existing) {
      for (const phone of normalizedPhones(row)) if (!byPhone.has(phone)) byPhone.set(phone, row);
      for (const email of normalizedEmails(row)) if (!byEmail.has(email)) byEmail.set(email, row);
    }

    const next: ImportPlanItem[] = incoming.map((contact) => {
      const phoneMatch = contact.phones.map((item) => byPhone.get(item.normalized)).find(Boolean);
      const emailMatch = contact.emails.map((item) => byEmail.get(item.value.toLocaleLowerCase("en-US"))).find(Boolean);
      const match = byUid.get(contact.sourceUid) || phoneMatch || emailMatch || null;
      const merged = mergeImportedContact(contact, match ? {
        phone_numbers: match.phone_numbers,
        emails: match.emails,
        aliases: match.aliases,
        notes: match.notes,
      } : null);

      if (!match) return { incoming: contact, merged, existingId: null, status: "new" as const };

      const existingComparable: NormalizedImportedContact = {
        name: match.name,
        phones: (match.phone_numbers || []).length
          ? (match.phone_numbers || [])
          : (match.phone ? [{ label: "основной", value: match.phone, normalized: normalizePhone(match.phone) }] : []),
        emails: (match.emails || []).length
          ? (match.emails || [])
          : (match.email ? [{ label: "основной", value: match.email }] : []),
        aliases: match.aliases || [],
        notes: match.notes,
        source: contact.source,
        sourceUid: contact.sourceUid,
      };
      const changed =
        !match.source_uid ||
        match.source_uid !== contact.sourceUid ||
        comparable(existingComparable) !== comparable(merged);

      return {
        incoming: contact,
        merged,
        existingId: match.id,
        status: changed ? "merge" as const : "duplicate" as const,
      };
    });

    setPlan(next);
    setStatus(
      `Найдено: ${next.length}. Новых: ${next.filter((item) => item.status === "new").length}, ` +
      `обновить: ${next.filter((item) => item.status === "merge").length}, ` +
      `дубликатов: ${next.filter((item) => item.status === "duplicate").length}.`
    );
  }

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/\.vcf$/i.test(file.name) && !/vcard|text\//i.test(file.type || "")) {
      setStatus("Выбери файл .vcf / vCard.");
      event.target.value = "";
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setStatus("VCF слишком большой для безопасного разбора в браузере (лимит импорта 20 МБ).");
      event.target.value = "";
      return;
    }

    setBusy(true);
    setPlan([]);
    setStatus("Разбираю VCF локально…");
    try {
      const raw = await file.text();
      const parsed = parseVCard(raw);
      // Raw VCF exists only in this local variable and is never uploaded or persisted.
      if (!parsed.length) {
        setStatus("В VCF не нашла контактов с именами.");
        return;
      }
      await buildPlan(parsed);
    } catch (error) {
      console.error("phonebook_parse_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      setStatus(error instanceof Error ? error.message : "Не получилось разобрать VCF.");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  async function pickContacts() {
    const picker = (navigator as ContactPickerNavigator).contacts;
    if (!picker?.select) return;
    setBusy(true);
    setPlan([]);
    setStatus("Открой системный выбор контактов…");
    try {
      const selected = await picker.select(["name","tel","email"], { multiple: true });
      const normalized = selected.map(normalizePickedContact).filter((item): item is NormalizedImportedContact => Boolean(item));
      if (!normalized.length) {
        setStatus("Контакты не выбраны.");
        return;
      }
      await buildPlan(normalized);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("Выбор контактов отменён.");
      } else {
        console.error("contact_picker_failed", {
          name: error instanceof Error ? error.name : "unknown",
          message: error instanceof Error ? error.message : String(error),
        });
        setStatus("Системный выбор контактов недоступен. Используй импорт .vcf.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function commitImport() {
    if (!supabase || !plan.length) return;
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      setStatus("Нужно войти в Глашу.");
      return;
    }

    setBusy(true);
    setStatus("Импортирую контакты…");
    let imported = 0;
    let mergedCount = 0;
    let skipped = counts.duplicateCount;

    try {
      for (const item of plan) {
        if (item.status === "duplicate") continue;
        const row = {
          user_id: auth.user.id,
          name: item.merged.name,
          phone: item.merged.phones[0]?.value || null,
          email: item.merged.emails[0]?.value || null,
          phone_numbers: item.merged.phones,
          emails: item.merged.emails,
          aliases: item.merged.aliases,
          notes: item.merged.notes,
          source: item.incoming.source,
          source_uid: item.incoming.sourceUid,
          updated_at: new Date().toISOString(),
        };

        if (item.existingId) {
          const { error } = await supabase.from("contacts")
            .update(row)
            .eq("user_id", auth.user.id)
            .eq("id", item.existingId);
          if (error) throw error;
          mergedCount += 1;
        } else {
          const { error } = await supabase.from("contacts").insert(row);
          if (error) {
            if (error.code === "23505") {
              skipped += 1;
              continue;
            }
            throw error;
          }
          imported += 1;
        }
      }

      setStatus(`Готово: добавлено ${imported}, объединено ${mergedCount}, пропущено ${skipped}.`);
      setPlan([]);
      await onImported();
    } catch (error) {
      console.error("phonebook_import_failed", {
        code: typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code || "") : "",
        message: error instanceof Error ? error.message : String(error),
      });
      setStatus("Импорт остановлен из-за ошибки базы. Уже сохранённые до ошибки контакты не дублируются при повторном импорте.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="phonebookImport">
    <div className="phonebookActions">
      <label className="linkButton fileButton">
        Импорт телефонной книги (.vcf)
        <input ref={fileRef} type="file" accept=".vcf,text/vcard,text/x-vcard" onChange={chooseFile} disabled={!liveData || busy} />
      </label>
      {pickerSupported && <button type="button" className="linkButton" onClick={() => void pickContacts()} disabled={!liveData || busy}>Выбрать из телефона</button>}
    </div>

    {!pickerSupported && <p className="muted">Системный выбор контактов в этом браузере не поддерживается — импорт .vcf работает независимо от него.</p>}

    {plan.length > 0 && <div className="phonebookPreview">
      <div className="phonebookSummary">
        <b>{counts.total} контактов</b>
        <small>Новых: {counts.newCount} · объединить: {counts.mergeCount} · дубликатов: {counts.duplicateCount}</small>
      </div>
      <div className="phonebookPreviewList">
        {plan.slice(0, 50).map((item) => <div className="phonebookPreviewRow" key={item.incoming.sourceUid}>
          <span className={`importStatus ${item.status}`}>{item.status === "new" ? "новый" : item.status === "merge" ? "обновить" : "дубликат"}</span>
          <div><b>{item.incoming.name}</b><small>{item.merged.phones.length} тел. · {item.merged.emails.length} email</small></div>
        </div>)}
        {plan.length > 50 && <p className="muted">И ещё {plan.length - 50} контактов.</p>}
      </div>
      <button type="button" className="primaryButton" onClick={() => void commitImport()} disabled={busy || (!counts.newCount && !counts.mergeCount)}>
        {busy ? "Импортирую…" : "Подтвердить импорт"}
      </button>
    </div>}

    {status && <p className="phonebookStatus">{status}</p>}
  </div>;
}
