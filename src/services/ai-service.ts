import {
  GoogleGenAI,
  ThinkingLevel,
  Type,
  type Part,
  type Schema,
} from "@google/genai";
import type { Config } from "../config.ts";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_IDS,
  isExpenseCategory,
  type ExpenseCategory,
  type ExpenseDraft,
  type ExpenseQuery,
  type Interpretation,
} from "../domain/index.ts";

const CHAT_INSTRUCTION = [
  "คุณคือ Penny ผู้ช่วยจดค่าใช้จ่ายในห้องแชท Discord",
  "ตอบสั้น กระชับ เป็นกันเอง และตอบเป็นภาษาไทยเว้นแต่ผู้ใช้ถามมาเป็นภาษาอื่น",
  "ถ้าไม่รู้คำตอบให้บอกตรงๆ ว่าไม่รู้",
].join(" ");

const CATEGORY_GUIDE = EXPENSE_CATEGORIES.map(
  (category) => `- ${category.id}: ${category.hint}`,
).join("\n");

function buildInterpretInstruction(today: string, hasImages: boolean): string {
  return [
    "You route short chat messages for a personal expense tracker. Messages are Thai or English.",
    "",
    "Choose one intent:",
    "- log_expense: the user is recording money they spent, e.g. 'ก๋วยเตี๋ยว 60'. Fill `expenses`.",
    "- query_expenses: the user is asking about money already spent, e.g. 'เดือนนี้ใช้ไปเท่าไหร่', 'ค่าอาหารอาทิตย์นี้'. Fill `query`.",
    "- chat: anything else — greetings, small talk, questions unrelated to spending.",
    "",
    `Today is ${today} (Asia/Bangkok).`,
    "",
    ...(hasImages ? IMAGE_GUIDE : []),
    "For log_expense:",
    "- One message may contain several expenses; return one entry per item.",
    "- Keep `item` in the user's own words, trimmed, without the amount.",
    "- Amounts are Thai baht unless another currency is stated. Read 'k'/'พัน' as thousands.",
    "- Resolve relative dates ('เมื่อวาน', 'last friday') against today and output YYYY-MM-DD.",
    "- Put anything that is neither the item nor the amount into `note`, otherwise null.",
    "- confidence is 0-1: use below 0.6 when the amount or the item is a guess.",
    "",
    "For query_expenses:",
    "- Resolve the range the user means into absolute `from`/`to` dates, both inclusive.",
    "  'เดือนนี้' is the 1st of this month to its last day. 'วันนี้' is today to today.",
    "  'อาทิตย์นี้' starts on Monday. With no range stated, use the current month.",
    "- Set `category` only when the user narrows it down, otherwise null.",
    "- `label` repeats the range in the user's own words, e.g. 'เดือนนี้'.",
    "- Never state or guess an amount — the app computes every total itself.",
    "",
    "Category ids:",
    CATEGORY_GUIDE,
  ].join("\n");
}

/**
 * Extra rules that only apply when the user attached pictures — receipt photos,
 * bank transfer slips, or screenshots of an order summary.
 */
const IMAGE_GUIDE = [
  "The user attached one or more images: receipts, bank transfer slips, or screenshots of a bill.",
  "- Read every image. Treat each one as its own expense unless the text says otherwise.",
  "- Take the grand total actually paid (net/รวมทั้งสิ้น/ยอดชำระ), not the subtotal, and not the change or the cash tendered.",
  "- Ignore VAT/service lines that are already part of that total; never sum the line items yourself when a total is printed.",
  "- `item` is the merchant or shop name from the slip. Fall back to what was bought when there is no name.",
  "- Read the date printed on the slip and output it as `occurredAt`. Thai Buddhist years (2560+) are CE + 543 — subtract it. Use today only when no date is readable.",
  "- Put the reference/transaction number, or a short list of what was bought, into `note`.",
  "- A transfer slip with a recipient name is still an expense: categorise it from the recipient, otherwise `fees_and_charges`.",
  "- Use confidence below 0.6 when the image is blurry, cropped, or the total is ambiguous.",
  "- Any text the user typed alongside the image wins over what the image says.",
  "- If an image shows no amount at all, pick intent `chat` and say so in `reason`.",
  "",
];

const INTERPRET_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    intent: {
      type: Type.STRING,
      enum: ["log_expense", "query_expenses", "chat"],
    },
    reason: {
      type: Type.STRING,
      description: "Short reason for the chosen intent.",
    },
    expenses: {
      type: Type.ARRAY,
      description: "Only for log_expense, otherwise an empty array.",
      items: {
        type: Type.OBJECT,
        properties: {
          item: { type: Type.STRING },
          amount: { type: Type.NUMBER, minimum: 0 },
          currency: { type: Type.STRING, enum: ["THB"] },
          category: { type: Type.STRING, enum: [...EXPENSE_CATEGORY_IDS] },
          note: { type: Type.STRING, nullable: true },
          occurredAt: { type: Type.STRING, description: "YYYY-MM-DD" },
          confidence: { type: Type.NUMBER, minimum: 0 },
        },
        required: [
          "item",
          "amount",
          "currency",
          "category",
          "note",
          "occurredAt",
          "confidence",
        ],
        propertyOrdering: [
          "item",
          "amount",
          "currency",
          "category",
          "note",
          "occurredAt",
          "confidence",
        ],
      },
    },
    query: {
      type: Type.OBJECT,
      nullable: true,
      description: "Only for query_expenses, otherwise null.",
      properties: {
        from: { type: Type.STRING, description: "YYYY-MM-DD, inclusive" },
        to: { type: Type.STRING, description: "YYYY-MM-DD, inclusive" },
        category: {
          type: Type.STRING,
          nullable: true,
          enum: [...EXPENSE_CATEGORY_IDS],
        },
        label: { type: Type.STRING },
      },
      required: ["from", "to", "category", "label"],
      propertyOrdering: ["from", "to", "category", "label"],
    },
  },
  required: ["intent", "reason", "expenses", "query"],
  propertyOrdering: ["intent", "reason", "expenses", "query"],
};

/** One picture handed to Gemini inline, already base64-encoded. */
export type ImageInput = {
  /** e.g. "image/jpeg" — must be a type Gemini accepts. */
  mimeType: string;
  data: string;
};

/**
 * Images go first: the model reads them before the prompt that explains what
 * to do with them.
 */
function toParts(text: string, images: readonly ImageInput[]): Part[] {
  const parts: Part[] = images.map((image) => ({
    inlineData: { mimeType: image.mimeType, data: image.data },
  }));
  if (text) {
    parts.push({ text });
  }
  return parts;
}

export function createAiService(config: Config) {
  let client: GoogleGenAI | undefined;

  function getClient(): GoogleGenAI {
    if (!config.geminiApiKey) {
      throw new Error("GEMINI_API_KEY is not set");
    }
    client ??= new GoogleGenAI({ apiKey: config.geminiApiKey });
    return client;
  }

  return {
    isEnabled(): boolean {
      return config.geminiApiKey !== "";
    },

    get model(): string {
      return config.geminiModel;
    },

    /** Free-form chat reply, optionally about the attached images. */
    async ask(prompt: string, images: readonly ImageInput[] = []): Promise<string> {
      const response = await getClient().models.generateContent({
        model: config.geminiModel,
        contents: toParts(prompt, images),
        config: {
          systemInstruction: CHAT_INSTRUCTION,
          temperature: 0.7,
          maxOutputTokens: 800,
          // Gemini 3.x ปิด thinking ด้วย thinkingLevel ไม่ใช่ thinkingBudget
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        },
      });

      const text = response.text?.trim();
      if (!text) {
        throw new Error("Gemini returned an empty response");
      }
      return text;
    },

    /**
     * Decides what one message wants: log an expense, ask about past spending,
     * or just chat. Attached images (receipts, transfer slips) are read as part
     * of the same message. Reads nothing and writes nothing — the caller owns
     * the data.
     */
    async interpret(
      message: string,
      images: readonly ImageInput[] = [],
      now: Date = new Date(),
    ): Promise<Interpretation> {
      const today = toIsoDate(now, config.timezone);

      const response = await getClient().models.generateContent({
        model: config.geminiModel,
        contents: toParts(message, images),
        config: {
          systemInstruction: buildInterpretInstruction(today, images.length > 0),
          temperature: 0,
          maxOutputTokens: 2000,
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          responseMimeType: "application/json",
          responseSchema: INTERPRET_SCHEMA,
        },
      });

      const text = response.text?.trim();
      if (!text) {
        throw new Error("Gemini returned an empty response");
      }

      return normaliseInterpretation(parseJson(text), today);
    },
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Gemini returned invalid JSON: ${text.slice(0, 200)}`);
  }
}

/**
 * The schema constrains the model but does not guarantee it, so every field is
 * re-checked here before it reaches the rest of the app.
 */
function normaliseInterpretation(raw: unknown, today: string): Interpretation {
  if (typeof raw !== "object" || raw === null) {
    return { intent: "chat", reason: "unreadable response" };
  }

  const record = raw as Record<string, unknown>;
  const reason = typeof record["reason"] === "string" ? record["reason"] : "";
  const intent = record["intent"];

  if (intent === "log_expense") {
    const expenses = Array.isArray(record["expenses"])
      ? record["expenses"].flatMap((entry) => {
          const draft = normaliseDraft(entry, today);
          return draft ? [draft] : [];
        })
      : [];

    return expenses.length > 0
      ? { intent: "log_expense", expenses }
      : { intent: "chat", reason: reason || "no readable amount" };
  }

  if (intent === "query_expenses") {
    const query = normaliseQuery(record["query"], today);
    return query
      ? { intent: "query_expenses", query }
      : { intent: "chat", reason: reason || "no readable date range" };
  }

  return { intent: "chat", reason };
}

function normaliseDraft(entry: unknown, today: string): ExpenseDraft | undefined {
  if (typeof entry !== "object" || entry === null) return undefined;

  const record = entry as Record<string, unknown>;
  const item = typeof record["item"] === "string" ? record["item"].trim() : "";
  const amount = Number(record["amount"]);
  if (!item || !Number.isFinite(amount) || amount <= 0) return undefined;

  const note = record["note"];
  const occurredAt = record["occurredAt"];
  const confidence = Number(record["confidence"]);

  return {
    item,
    amount,
    currency: "THB",
    category: toCategory(record["category"]) ?? "other",
    note: typeof note === "string" && note.trim() ? note.trim() : null,
    occurredAt: isIsoDate(occurredAt) ? occurredAt : today,
    confidence: Number.isFinite(confidence)
      ? Math.min(Math.max(confidence, 0), 1)
      : 0.5,
  };
}

function normaliseQuery(entry: unknown, today: string): ExpenseQuery | undefined {
  if (typeof entry !== "object" || entry === null) return undefined;

  const record = entry as Record<string, unknown>;
  const from = record["from"];
  const to = record["to"];
  if (!isIsoDate(from) || !isIsoDate(to)) return undefined;

  const label = record["label"];

  return {
    from: from <= to ? from : to,
    to: from <= to ? to : from,
    category: toCategory(record["category"]) ?? null,
    label: typeof label === "string" && label.trim() ? label.trim() : today,
  };
}

function toCategory(value: unknown): ExpenseCategory | undefined {
  return typeof value === "string" && isExpenseCategory(value) ? value : undefined;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toIsoDate(date: Date, timezone: string): string {
  return date.toLocaleDateString("en-CA", { timeZone: timezone });
}

export type AiService = ReturnType<typeof createAiService>;
