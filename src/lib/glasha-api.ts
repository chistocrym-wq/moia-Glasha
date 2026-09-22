export type AssistantResponse = {
  ok?: boolean;
  action?: string;
  reply?: string;
  needs_clarification?: boolean;
  data?: unknown;
  summary?: unknown;
  error?: string;
};

export type SystemStatus = {
  supabase: boolean;
  openai: boolean;
  transcribe: boolean;
};

async function parseJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error || "request_failed") as Error & { status?: number; payload?: unknown };
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

export async function getSystemStatus(): Promise<SystemStatus> {
  const response = await fetch("/api/system/status", { cache: "no-store" });
  return parseJson(response);
}

export async function sendAssistantCommand(text: string, source: "text" | "voice" = "text"): Promise<AssistantResponse> {
  const response = await fetch("/api/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, source }),
  });
  return parseJson(response);
}

export async function transcribeVoice(blob: Blob): Promise<string> {
  const form = new FormData();
  form.append("audio", new File([blob], "glasha-voice.webm", { type: blob.type || "audio/webm" }));
  const response = await fetch("/api/voice/transcribe", { method: "POST", body: form });
  const data = await parseJson(response);
  return String(data.text || "");
}

export async function askAdvisor(question: string): Promise<string> {
  const response = await fetch("/api/advisor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  const data = await parseJson(response);
  return String(data.answer || "");
}

export async function uploadEntityAttachment(entityType: string, entityId: string, file: File) {
  const form = new FormData();
  form.append("entity_type", entityType);
  form.append("entity_id", entityId);
  form.append("file", file);
  const response = await fetch("/api/attachments", { method: "POST", body: form });
  return parseJson(response);
}
