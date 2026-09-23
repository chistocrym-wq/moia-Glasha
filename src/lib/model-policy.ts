export type ModelTier = "fast" | "deep";

const FAST_MODEL = process.env.OPENAI_MODEL_FAST || process.env.OPENAI_MODEL || "gpt-5.6-luna";
const DEEP_MODEL = process.env.OPENAI_MODEL_DEEP || process.env.OPENAI_ADVISOR_MODEL || "gpt-5.6-terra";
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";

const DEEP_HINTS = [
  "проанализ",
  "сравни",
  "стратег",
  "план действий",
  "разложи по шагам",
  "что лучше",
  "варианты",
  "риски",
  "юрист",
  "юрид",
  "врач",
  "медицин",
  "диагноз",
  "инвести",
  "налог",
  "договор",
  "документ",
  "переезд",
  "иммигра",
  "сложн",
];

export function fastModel() {
  return FAST_MODEL;
}

export function transcriptionModel() {
  return TRANSCRIBE_MODEL;
}

export function chooseAdvisorModel(input: {
  question: string;
  explicitDeep?: boolean;
  useWeb?: boolean;
  contextItems?: number;
}) {
  const text = input.question.toLowerCase();
  let score = 0;

  if (input.explicitDeep) score += 4;
  if (input.useWeb) score += 1;
  if (input.question.length > 700) score += 2;
  else if (input.question.length > 320) score += 1;
  if ((input.contextItems ?? 0) > 35) score += 1;
  if (DEEP_HINTS.some((hint) => text.includes(hint))) score += 2;

  const tier: ModelTier = score >= 3 ? "deep" : "fast";
  return {
    tier,
    model: tier === "deep" ? DEEP_MODEL : FAST_MODEL,
    reasoning: tier === "deep" ? "medium" as const : "low" as const,
  };
}

export const MODEL_POLICY = {
  fast: FAST_MODEL,
  deep: DEEP_MODEL,
  transcribe: TRANSCRIBE_MODEL,
};
