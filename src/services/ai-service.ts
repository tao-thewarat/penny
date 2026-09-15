import {
  GoogleGenAI,
  ThinkingLevel,
  Type,
  type Part,
  type Schema,
} from "@google/genai";
import type { Config } from "../config.ts";
import {
  categoriesFor,
  ENTRY_CATEGORY_IDS,
  fallbackCategoryFor,
  isCategoryFor,
  type EntryCategory,
  type EntryDraft,
  type EntryQuery,
  type EntryType,
  type Interpretation,
} from "../domain/index.ts";

/**
 * ข้อความจะมาถึง `ask` ก็ต่อเมื่อ `interpret` ตัดสินว่าไม่ใช่รายการเงินและไม่ใช่
 * คำถามเรื่องยอด แปลว่าเส้นทางนี้ไม่ได้บันทึกอะไรเลย โมเดลจึงต้องถูก
 * ห้ามไม่ให้ตอบว่า "บันทึกแล้ว" ซึ่งเป็นคำตอบที่หลุดมาได้ง่าย
 */
const CHAT_INSTRUCTION = [
  "คุณคือ Penny ผู้ช่วยจดรายรับรายจ่ายในห้องแชท Discord",
  "ตอบสั้น กระชับ เป็นกันเอง และตอบเป็นภาษาไทยเว้นแต่ผู้ใช้ถามมาเป็นภาษาอื่น",
  "ถ้าไม่รู้คำตอบให้บอกตรงๆ ว่าไม่รู้",
  "สำคัญมาก: ข้อความที่ส่งมาถึงคุณตอนนี้ยังไม่ได้ถูกบันทึกลงฐานข้อมูล และคุณเองบันทึกอะไรไม่ได้เลย",
  "ห้ามพูดว่าบันทึกแล้ว จดให้แล้ว เก็บไว้ให้แล้ว หรือเรียบร้อย และห้ามทวนตัวเลขในลักษณะที่ทำให้ผู้ใช้เข้าใจว่าระบบเก็บข้อมูลให้",
  "ถ้าผู้ใช้อยากจดรายการ ให้บอกวิธีพิมพ์ เช่น 'ก๋วยเตี๋ยว 60' สำหรับรายจ่าย หรือ 'เงินเดือน 30000' สำหรับรายรับ",
].join(" ");

function categoryGuide(type: EntryType): string {
  return categoriesFor(type)
    .map((category) => `- ${category.id}: ${category.hint}`)
    .join("\n");
}

function buildInterpretInstruction(today: string, hasImages: boolean): string {
  return [
    "You route short chat messages for a personal money tracker that records both spending and income. Messages are Thai or English.",
    "",
    "Choose one intent:",
    "- log_entry: the user is recording money that moved — spent, e.g. 'ก๋วยเตี๋ยว 60', or received, e.g. 'เงินเดือน 30000'. Fill `entries`.",
    "- query_entries: the user is asking about money already recorded, e.g. 'เดือนนี้ใช้ไปเท่าไหร่', 'ค่าอาหารอาทิตย์นี้', 'เดือนนี้รายรับเท่าไหร่', 'เหลือเท่าไหร่'. Fill `query`.",
    "- chat: anything else — greetings, small talk, questions unrelated to money.",
    "",
    `Today is ${today} (Asia/Bangkok).`,
    "",
    ...(hasImages ? IMAGE_GUIDE : []),
    "For log_entry:",
    "- One message may contain several entries, and they may mix directions; return one entry per item.",
    "- Set `type` to 'income' when the user received the money, 'expense' when they paid it out.",
    "  Income cues: เงินเดือน, ค่าจ้าง, โบนัส, ได้เงิน, ได้มา, รับเงิน, เงินเข้า, โอนเข้า, ขายได้, กำไร, ดอกเบี้ย, ปันผล, คืนเงิน, เบิกคืน, salary, got paid, refund, cashback.",
    "  Expense cues: จ่าย, ซื้อ, เสีย, ค่า…, and a bare 'item + number' with no other signal.",
    "- When the direction is genuinely unclear, choose 'expense' — that is the common case.",
    "- `amount` is always a positive number. Never make it negative for income or expenses.",
    "- Keep `item` in the user's own words, trimmed, without the amount.",
    "- Amounts are Thai baht unless another currency is stated. Read 'k'/'พัน' as thousands.",
    "- Resolve relative dates ('เมื่อวาน', 'last friday') against today and output YYYY-MM-DD.",
    "- Put anything that is neither the item nor the amount into `note`, otherwise null.",
    "- confidence is 0-1: use below 0.6 when the amount, the item, or the direction is a guess.",
    "",
    "For query_entries:",
    "- Resolve the range the user means into absolute `from`/`to` dates, both inclusive.",
    "  'เดือนนี้' is the 1st of this month to its last day. 'วันนี้' is today to today.",
    "  'อาทิตย์นี้' starts on Monday. With no range stated, use the current month.",
    "- Set `type` to 'expense' when they ask about spending, 'income' when they ask about รายรับ/เงินเข้า,",
    "  and null when they want both sides — 'สรุป', 'เหลือเท่าไหร่', 'เดือนนี้เป็นไง'.",
    "- Set `category` only when the user narrows it down, otherwise null. It must match `type` when `type` is set.",
    "- `label` repeats the range in the user's own words, e.g. 'เดือนนี้'.",
    "- Never state or guess an amount — the app computes every total itself.",
    "",
    "Expense category ids (use only with type 'expense'):",
    categoryGuide("expense"),
    "",
    "Income category ids (use only with type 'income'):",
    categoryGuide("income"),
  ].join("\n");
}

/**
 * Extra rules that only apply when the user attached pictures — receipt photos,
 * bank transfer slips, or screenshots of an order summary.
 */
const IMAGE_GUIDE = [
  "The user attached one or more images: receipts, bank transfer slips, or screenshots of a bill.",
  "- Read every image. Treat each one as its own entry unless the text says otherwise.",
  "- Take the grand total actually paid (net/รวมทั้งสิ้น/ยอดชำระ), not the subtotal, and not the change or the cash tendered.",
  "- Ignore VAT/service lines that are already part of that total; never sum the line items yourself when a total is printed.",
  "- `item` is the merchant or shop name from the slip. Fall back to what was bought when there is no name.",
  "- Read the date printed on the slip and output it as `occurredAt`. Thai Buddhist years (2560+) are CE + 543 — subtract it. Use today only when no date is readable.",
  "- Put the reference/transaction number, or a short list of what was bought, into `note`.",
  "- A receipt is always an expense. A transfer slip depends on direction: money leaving the user's account is an expense, money arriving (เงินเข้า, รับโอน, ยอดเงินเข้าบัญชี, a payslip) is income.",
  "- For an outgoing transfer with a recipient name, categorise it from the recipient, otherwise `fees_and_charges`.",
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
      enum: ["log_entry", "query_entries", "chat"],
    },
    reason: {
      type: Type.STRING,
      description: "Short reason for the chosen intent.",
    },
    entries: {
      type: Type.ARRAY,
      description: "Only for log_entry, otherwise an empty array.",
      items: {
        type: Type.OBJECT,
        properties: {
          type: { type: Type.STRING, enum: ["expense", "income"] },
          item: { type: Type.STRING },
          amount: { type: Type.NUMBER, minimum: 0 },
          currency: { type: Type.STRING, enum: ["THB"] },
          category: { type: Type.STRING, enum: [...ENTRY_CATEGORY_IDS] },
          note: { type: Type.STRING, nullable: true },
          occurredAt: { type: Type.STRING, description: "YYYY-MM-DD" },
          confidence: { type: Type.NUMBER, minimum: 0 },
        },
        required: [
          "type",
          "item",
          "amount",
          "currency",
          "category",
          "note",
          "occurredAt",
          "confidence",
        ],
        propertyOrdering: [
          "type",
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
      description: "Only for query_entries, otherwise null.",
      properties: {
        from: { type: Type.STRING, description: "YYYY-MM-DD, inclusive" },
        to: { type: Type.STRING, description: "YYYY-MM-DD, inclusive" },
        type: {
          type: Type.STRING,
          nullable: true,
          enum: ["expense", "income"],
        },
        category: {
          type: Type.STRING,
          nullable: true,
          enum: [...ENTRY_CATEGORY_IDS],
        },
        label: { type: Type.STRING },
      },
      required: ["from", "to", "type", "category", "label"],
      propertyOrdering: ["from", "to", "type", "category", "label"],
    },
  },
  required: ["intent", "reason", "entries", "query"],
  propertyOrdering: ["intent", "reason", "entries", "query"],
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
     * Decides what one message wants: log money in or out, ask about what was
     * recorded, or just chat. Attached images (receipts, transfer slips) are
     * read as part of the same message. Reads nothing and writes nothing — the
     * caller owns the data.
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

  if (intent === "log_entry") {
    const entries = Array.isArray(record["entries"])
      ? record["entries"].flatMap((entry) => {
          const draft = normaliseDraft(entry, today);
          return draft ? [draft] : [];
        })
      : [];

    return entries.length > 0
      ? { intent: "log_entry", entries }
      : { intent: "chat", reason: reason || "no readable amount" };
  }

  if (intent === "query_entries") {
    const query = normaliseQuery(record["query"], today);
    return query
      ? { intent: "query_entries", query }
      : { intent: "chat", reason: reason || "no readable date range" };
  }

  return { intent: "chat", reason };
}

function normaliseDraft(entry: unknown, today: string): EntryDraft | undefined {
  if (typeof entry !== "object" || entry === null) return undefined;

  const record = entry as Record<string, unknown>;
  const item = typeof record["item"] === "string" ? record["item"].trim() : "";
  // A model that answers with a signed amount still means the same entry, and
  // `type` is what carries the direction from here on.
  const amount = Math.abs(Number(record["amount"]));
  if (!item || !Number.isFinite(amount) || amount <= 0) return undefined;

  const type = toEntryType(record["type"]) ?? "expense";
  const note = record["note"];
  const occurredAt = record["occurredAt"];
  const confidence = Number(record["confidence"]);

  return {
    type,
    item,
    amount,
    currency: "THB",
    category: toCategory(record["category"], type),
    note: typeof note === "string" && note.trim() ? note.trim() : null,
    occurredAt: isIsoDate(occurredAt) ? occurredAt : today,
    confidence: Number.isFinite(confidence)
      ? Math.min(Math.max(confidence, 0), 1)
      : 0.5,
  };
}

function normaliseQuery(entry: unknown, today: string): EntryQuery | undefined {
  if (typeof entry !== "object" || entry === null) return undefined;

  const record = entry as Record<string, unknown>;
  const from = record["from"];
  const to = record["to"];
  if (!isIsoDate(from) || !isIsoDate(to)) return undefined;

  const label = record["label"];
  const type = toEntryType(record["type"]) ?? null;
  const rawCategory = record["category"];

  // A category from the other side of the ledger would filter everything out,
  // so it is dropped rather than narrowing the query to nothing.
  const category =
    typeof rawCategory === "string" &&
    (type === null
      ? isCategoryFor(rawCategory, "expense") || isCategoryFor(rawCategory, "income")
      : isCategoryFor(rawCategory, type))
      ? (rawCategory as EntryCategory)
      : null;

  return {
    from: from <= to ? from : to,
    to: from <= to ? to : from,
    type,
    category,
    label: typeof label === "string" && label.trim() ? label.trim() : today,
  };
}

function toEntryType(value: unknown): EntryType | undefined {
  return value === "expense" || value === "income" ? value : undefined;
}

/** Keeps the category on the same side of the ledger as `type`. */
function toCategory(value: unknown, type: EntryType): EntryCategory {
  return typeof value === "string" && isCategoryFor(value, type)
    ? (value as EntryCategory)
    : fallbackCategoryFor(type);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toIsoDate(date: Date, timezone: string): string {
  return date.toLocaleDateString("en-CA", { timeZone: timezone });
}

export type AiService = ReturnType<typeof createAiService>;
