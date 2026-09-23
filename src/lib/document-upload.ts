"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import * as tus from "tus-js-client";

export const DOCUMENT_BUCKET = "glasha-private";
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const RESUMABLE_FROM_BYTES = 5 * 1024 * 1024;
const TUS_CHUNK_BYTES = 6 * 1024 * 1024;

export type DocumentOwner = "user" | "child" | "mother" | "work" | "other";

export type DocumentUploadMetadata = {
  title: string;
  ownerPerson: DocumentOwner;
  ownerName?: string;
  documentType: string;
  expiryDate?: string;
  tags?: string[];
};

export type UploadedDocument = {
  id: string;
  title: string;
  owner_person: string;
  owner_name: string | null;
  document_type: string;
  expiry_date: string | null;
  tags: string[];
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
};

export class DocumentUploadError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DocumentUploadError";
    this.code = code;
  }
}

function safeFilename(name: string) {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) : "";
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\\/]+/g, "_")
    .replace(/[^a-zA-Z0-9._()-]+/g, "_")
    .replace(/^\.+/, "")
    .replace(/_+/g, "_")
    .slice(0, 150) || "document";
  return ext ? `${base}.${ext}` : base;
}

function projectRefFromUrl(projectUrl: string) {
  const host = new URL(projectUrl).hostname;
  const match = host.match(/^([a-z0-9-]+)\.supabase\.co$/i);
  if (!match) throw new DocumentUploadError("bad_supabase_url", "Не удалось определить Storage endpoint.");
  return match[1];
}

function resumableUpload(
  supabase: SupabaseClient,
  file: File,
  storagePath: string,
  onProgress?: (percent: number) => void,
) {
  return new Promise<void>(async (resolve, reject) => {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session?.access_token) {
      reject(new DocumentUploadError("auth_required", "Сессия истекла. Войди в Глашу снова."));
      return;
    }
    if (session.user.id !== storagePath.split("/")[0]) {
      reject(new DocumentUploadError("user_mismatch", "Сессия не совпадает с владельцем документа."));
      return;
    }

    const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!projectUrl) {
      reject(new DocumentUploadError("supabase_not_configured", "Supabase не настроен."));
      return;
    }

    let projectRef: string;
    try {
      projectRef = projectRefFromUrl(projectUrl);
    } catch (projectError) {
      reject(projectError);
      return;
    }

    const upload = new tus.Upload(file, {
      endpoint: `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "x-upsert": "false",
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: TUS_CHUNK_BYTES,
      metadata: {
        bucketName: DOCUMENT_BUCKET,
        objectName: storagePath,
        contentType: file.type || "application/octet-stream",
        cacheControl: "3600",
      },
      onError(error) {
        const detailed = error as Error & {
          originalResponse?: {
            getStatus?: () => number;
            getBody?: () => string;
          };
        };
        const status = detailed.originalResponse?.getStatus?.();
        const responseBody = detailed.originalResponse?.getBody?.();
        console.error("document_tus_upload_failed", {
          status: status ?? null,
          message: detailed.message,
          responseBody: responseBody || null,
          storagePath,
          sizeBytes: file.size,
        });
        reject(new DocumentUploadError(
          status ? `storage_tus_${status}` : "storage_tus_failed",
          status === 413
            ? "Файл превышает разрешённый размер."
            : status === 401 || status === 403
              ? "Storage отклонил загрузку. Проверь вход в аккаунт и права доступа."
              : `Не удалось загрузить файл в Storage${status ? ` (HTTP ${status})` : ""}.`,
        ));
      },
      onProgress(bytesUploaded, bytesTotal) {
        const percent = bytesTotal ? Math.round((bytesUploaded / bytesTotal) * 100) : 0;
        onProgress?.(percent);
      },
      onSuccess() {
        onProgress?.(100);
        resolve();
      },
    });

    try {
      const previous = await upload.findPreviousUploads();
      if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    } catch (resumeError) {
      reject(new DocumentUploadError(
        "storage_tus_start_failed",
        resumeError instanceof Error ? resumeError.message : "Не удалось начать загрузку.",
      ));
    }
  });
}

export async function uploadDocumentDirect(
  supabase: SupabaseClient,
  userId: string,
  file: File,
  metadata: DocumentUploadMetadata,
  onProgress?: (percent: number) => void,
): Promise<UploadedDocument> {
  const title = metadata.title.trim();
  const documentType = metadata.documentType.trim() || "other";
  const tags = (metadata.tags ?? []).map((tag) => tag.trim()).filter(Boolean).slice(0, 30);

  if (!title) throw new DocumentUploadError("title_required", "Укажи название документа.");
  if (!file.size) throw new DocumentUploadError("empty_file", "Выбран пустой файл.");
  if (file.size > MAX_DOCUMENT_BYTES) {
    throw new DocumentUploadError("file_too_large", "Максимальный размер документа — 50 МБ.");
  }

  const storagePath = `${userId}/documents/${crypto.randomUUID()}-${safeFilename(file.name)}`;
  let uploaded = false;

  try {
    onProgress?.(0);

    if (file.size >= RESUMABLE_FROM_BYTES) {
      await resumableUpload(supabase, file, storagePath, onProgress);
    } else {
      const { error: uploadError } = await supabase.storage
        .from(DOCUMENT_BUCKET)
        .upload(storagePath, file, {
          contentType: file.type || "application/octet-stream",
          upsert: false,
          cacheControl: "3600",
        });

      if (uploadError) {
        throw new DocumentUploadError(
          uploadError.name || "storage_upload_failed",
          uploadError.message || "Не удалось загрузить файл в Storage.",
        );
      }
      onProgress?.(100);
    }

    uploaded = true;

    const { data, error: metadataError } = await supabase
      .from("documents")
      .insert({
        user_id: userId,
        owner_person: metadata.ownerPerson,
        owner_name: metadata.ownerName?.trim() || null,
        document_type: documentType,
        title,
        expiry_date: metadata.expiryDate || null,
        tags,
        storage_path: storagePath,
        mime_type: file.type || null,
        size_bytes: file.size,
      })
      .select("id,title,owner_person,owner_name,document_type,expiry_date,tags,storage_path,mime_type,size_bytes,created_at")
      .single();

    if (metadataError) {
      const { error: rollbackError } = await supabase.storage
        .from(DOCUMENT_BUCKET)
        .remove([storagePath]);
      uploaded = false;
      if (rollbackError) {
        console.error("document_metadata_rollback_failed", {
          code: rollbackError.name,
          message: rollbackError.message,
          storagePath,
        });
      }
      throw new DocumentUploadError(
        `metadata_${metadataError.code || "failed"}`,
        `Файл загрузился, но карточка документа не сохранилась: ${metadataError.message}`,
      );
    }

    return data as UploadedDocument;
  } catch (error) {
    if (uploaded && !(error instanceof DocumentUploadError && error.code === "document_metadata_failed")) {
      const { error: rollbackError } = await supabase.storage
        .from(DOCUMENT_BUCKET)
        .remove([storagePath]);
      if (rollbackError) {
        console.error("document_upload_rollback_failed", {
          code: rollbackError.name,
          message: rollbackError.message,
          storagePath,
        });
      }
    }

    if (error instanceof DocumentUploadError) throw error;

    const message = error instanceof Error ? error.message : "Неизвестная ошибка загрузки.";
    throw new DocumentUploadError("document_upload_failed", message);
  }
}

export function documentUploadUserMessage(error: unknown) {
  if (error instanceof DocumentUploadError) {
    if (error.code === "auth_required") return "Сессия закончилась. Войди в Глашу снова.";
    if (error.code === "file_too_large") return "Файл больше 50 МБ. Выбери файл поменьше.";
    if (error.code.startsWith("storage_tus_")) return error.message;
    if (error.code.includes("row-level") || /row.level|rls/i.test(error.message)) {
      return "Storage отклонил загрузку по правилам доступа. Проверь вход в аккаунт.";
    }
    return error.message;
  }
  return "Не удалось загрузить документ.";
}
