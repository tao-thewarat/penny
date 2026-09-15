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
  getCategory,
  type Entry,
  type EntryDraft,
  type EntryType,
} from "../domain/index.ts";
import {
  SaveEntriesError,
  type EntryRepository,
} from "../repositories/entry-repository.ts";
import type { AiService, ImageInput } from "./ai-service.ts";

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
  entries: EntryRepository,
) {
  const portalUrl = new URL("/transactions/", config.transactionsApiUrl).href;

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
      case "log_entry": {
        try {
          const saved = await entries.saveMany(interpretation.entries, {
            userId: msg.author.id,
            sourceText: describeSource(content, images.length),
          });
          return formatSaved(saved);
        } catch (err: unknown) {
          // Nothing saved is an ordinary failure; a partial save must be
          // reported, or a retry would log the saved ones twice.
          if (!(err instanceof SaveEntriesError) || err.saved.length === 0) {
            throw err;
          }
          console.error("Partially saved entries:", err);
          return formatPartial(err.saved, interpretation.entries.length);
        }
      }

      // Summaries moved to portal-penny; the bot no longer reads any data.
      // The intent is still detected so the model does not answer with totals
      // it would have to invent.
      case "query_entries":
        return `ดูสรุปรายรับรายจ่ายได้ที่ ${portalUrl} ครับ`;

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

export function formatDrafts(drafts: EntryDraft[]): string {
  const lines = drafts.map((draft) => {
    const category = getCategory(draft.category);
    const unsure = draft.confidence < LOW_CONFIDENCE ? " ❓" : "";
    const note = draft.note ? ` (${draft.note})` : "";
    return `${category.emoji} **${draft.item}** — ${formatSigned(draft.amount, draft.type)} ${draft.currency}${note}\n   ${category.label} · ${draft.occurredAt}${unsure}`;
  });

  return `${lines.join("\n")}${formatDraftTotals(drafts)}`;
}

/**
 * One entry speaks for itself. Several need a total, and a message that mixed
 * income with spending needs both sides plus the net.
 */
function formatDraftTotals(drafts: EntryDraft[]): string {
  if (drafts.length < 2) return "";

  const income = sumOf(drafts, "income");
  const expense = sumOf(drafts, "expense");

  if (income === 0) return `\n\nรวมรายจ่าย **${formatAmount(expense)} THB**`;
  if (expense === 0) return `\n\nรวมรายรับ **${formatAmount(income)} THB**`;

  return [
    "",
    "",
    `รายรับ **+${formatAmount(income)}** · รายจ่าย **-${formatAmount(expense)}** · สุทธิ **${formatNet(income - expense)} THB**`,
  ].join("\n");
}

function sumOf(drafts: EntryDraft[], type: EntryType): number {
  return drafts
    .filter((draft) => draft.type === type)
    .reduce((sum, draft) => sum + draft.amount, 0);
}

export function formatSaved(saved: Entry[]): string {
  return `${formatDrafts(saved)}\n\n_บันทึกแล้ว ${saved.length} รายการ_`;
}

function formatPartial(saved: Entry[], attempted: number): string {
  return [
    formatDrafts(saved),
    "",
    `_บันทึกได้ ${saved.length} จาก ${attempted} รายการ ที่เหลือบันทึกไม่สำเร็จ — ส่งเฉพาะรายการที่ขาดมาใหม่นะครับ_`,
  ].join("\n");
}

function formatAmount(amount: number): string {
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

/** Signed for a ledger line: income adds, an expense takes away. */
function formatSigned(amount: number, type: EntryType): string {
  return `${type === "income" ? "+" : "-"}${formatAmount(amount)}`;
}

/** A net figure keeps its own sign, including when it is exactly zero. */
function formatNet(net: number): string {
  return `${net < 0 ? "-" : "+"}${formatAmount(Math.abs(net))}`;
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

export type DiscordService = ReturnType<typeof createDiscordService>;
