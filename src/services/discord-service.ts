import { Buffer } from "node:buffer";
import {
  Client,
  Events,
  GatewayIntentBits,
  type Attachment,
  type Message,
} from "discord.js";
import type { Config } from "../config.ts";
import {
  getExpenseCategory,
  type Expense,
  type ExpenseDraft,
  type ExpenseSummary,
} from "../domain/index.ts";
import type { ExpenseRepository } from "../repositories/expense-repository.ts";
import type { AiService, ImageInput } from "./ai-service.ts";
import type { FirebaseService } from "./firebase-service.ts";

const DISCORD_MESSAGE_LIMIT = 2000;
const LOW_CONFIDENCE = 0.6;

/** Image types Gemini accepts inline. Anything else is ignored, not an error. */
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
]);
/** One message rarely holds more slips than this, and each one costs tokens. */
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export function createDiscordService(
  config: Config,
  ai: AiService,
  firebase: FirebaseService,
  expenses: ExpenseRepository,
) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once(Events.ClientReady, (ready) => {
    console.log(`Discord bot online: ${ready.user.tag}`);
  });

  client.on(Events.MessageCreate, (msg) => {
    void handleMessage(msg).catch((err: unknown) => {
      console.error("Failed to handle Discord message:", err);
    });
  });

  async function handleMessage(msg: Message): Promise<void> {
    if (msg.author.bot || msg.channelId !== config.discordChannelId) return;

    const content = msg.content.trim();
    const attachments = pickImageAttachments(msg);
    if (!content && attachments.length === 0) return;

    if (!ai.isEnabled()) {
      await msg.reply("ยังตอบไม่ได้ครับ ยังไม่ได้ตั้งค่า GEMINI_API_KEY");
      return;
    }

    if (msg.channel.isSendable()) {
      void msg.channel.sendTyping().catch(() => {});
    }

    try {
      const images = await downloadImages(attachments);
      if (attachments.length > 0 && images.length === 0) {
        await reply(msg, "อ่านรูปไม่สำเร็จครับ ลองส่งใหม่อีกครั้งนะครับ");
        return;
      }
      await reply(msg, await route(msg, content, images));
    } catch (err: unknown) {
      console.error("Failed to answer:", err);
      await reply(msg, "ขออภัยครับ ตอนนี้ทำรายการไม่สำเร็จ ลองใหม่อีกครั้งนะครับ");
    }
  }

  async function route(
    msg: Message,
    content: string,
    images: ImageInput[],
  ): Promise<string> {
    const interpretation = await ai.interpret(content, images);

    switch (interpretation.intent) {
      case "log_expense": {
        if (!firebase.isEnabled()) {
          return `${formatDrafts(interpretation.expenses)}\n\n_ยังไม่ได้บันทึก: Firebase ยังไม่ได้ตั้งค่า_`;
        }
        const saved = await expenses.saveMany(interpretation.expenses, {
          userId: msg.author.id,
          sourceText: describeSource(content, images.length),
        });
        return formatSaved(saved);
      }

      case "query_expenses": {
        if (!firebase.isEnabled()) {
          return "ดูยอดไม่ได้ครับ Firebase ยังไม่ได้ตั้งค่า";
        }
        const summary = await expenses.summarise(
          interpretation.query,
          msg.author.id,
        );
        return formatSummary(summary);
      }

      case "chat":
        return ai.ask(content || "ผู้ใช้ส่งรูปมาโดยไม่มีข้อความ", images);
    }
  }

  async function reply(msg: Message, text: string): Promise<void> {
    await msg.reply(truncate(text, DISCORD_MESSAGE_LIMIT));
  }

  return {
    async start(): Promise<void> {
      if (!config.discordToken) {
        throw new Error("DISCORD_TOKEN is not set");
      }
      await client.login(config.discordToken);
    },

    async stop(): Promise<void> {
      await client.destroy();
    },
  };
}

/** Image attachments Gemini can read, oldest first, capped at MAX_IMAGES. */
function pickImageAttachments(msg: Message): Attachment[] {
  return [...msg.attachments.values()]
    .filter(
      (attachment) =>
        SUPPORTED_IMAGE_TYPES.has(normaliseMimeType(attachment.contentType)) &&
        attachment.size <= MAX_IMAGE_BYTES,
    )
    .slice(0, MAX_IMAGES);
}

/**
 * Discord only hands out CDN urls, and Gemini needs the bytes, so each picture
 * is fetched here. One failed download drops that image instead of the message.
 */
async function downloadImages(
  attachments: readonly Attachment[],
): Promise<ImageInput[]> {
  const downloads = await Promise.all(
    attachments.map(async (attachment) => {
      try {
        const response = await fetch(attachment.url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
          throw new Error(`unusable size: ${bytes.byteLength} bytes`);
        }
        return {
          mimeType: normaliseMimeType(attachment.contentType),
          data: bytes.toString("base64"),
        };
      } catch (err: unknown) {
        console.error(`Failed to download ${attachment.url}:`, err);
        return undefined;
      }
    }),
  );

  return downloads.filter((image): image is ImageInput => image !== undefined);
}

/** `contentType` arrives as e.g. "image/jpeg; charset=utf-8". */
function normaliseMimeType(contentType: string | null): string {
  return contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
}

/** sourceText must stay readable when the message was pictures only. */
function describeSource(content: string, imageCount: number): string {
  if (imageCount === 0) return content;
  const label = `[รูปภาพ ${imageCount} รูป]`;
  return content ? `${content} ${label}` : label;
}

export function formatDrafts(drafts: ExpenseDraft[]): string {
  const lines = drafts.map((draft) => {
    const category = getExpenseCategory(draft.category);
    const unsure = draft.confidence < LOW_CONFIDENCE ? " ❓" : "";
    const note = draft.note ? ` (${draft.note})` : "";
    return `${category.emoji} **${draft.item}** — ${formatAmount(draft.amount)} ${draft.currency}${note}\n   ${category.label} · ${draft.occurredAt}${unsure}`;
  });

  const total = drafts.reduce((sum, draft) => sum + draft.amount, 0);
  const totalLine =
    drafts.length > 1 ? `\n\nรวม **${formatAmount(total)} THB**` : "";

  return `${lines.join("\n")}${totalLine}`;
}

export function formatSaved(saved: Expense[]): string {
  return `${formatDrafts(saved)}\n\n_บันทึกแล้ว ${saved.length} รายการ_`;
}

export function formatSummary(summary: ExpenseSummary): string {
  const { query } = summary;
  const scope = query.category
    ? `${getExpenseCategory(query.category).label} · ${query.label}`
    : query.label;
  const range = `${query.from} → ${query.to}`;

  if (summary.count === 0) {
    return `📊 ${scope} (${range})\nยังไม่มีรายการในช่วงนี้ครับ`;
  }

  const breakdown = summary.byCategory
    .map((entry) => {
      const category = getExpenseCategory(entry.category);
      return `${category.emoji} ${category.label} — ${formatAmount(entry.total)} (${entry.count})`;
    })
    .join("\n");

  return [
    `📊 ${scope} (${range})`,
    `รวม **${formatAmount(summary.total)} ${summary.currency}** จาก ${summary.count} รายการ`,
    "",
    breakdown,
  ].join("\n");
}

function formatAmount(amount: number): string {
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

export type DiscordService = ReturnType<typeof createDiscordService>;
