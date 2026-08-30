import { Client, Events, GatewayIntentBits, type Message } from "discord.js";
import type { Config } from "../config.ts";
import {
  getExpenseCategory,
  type Expense,
  type ExpenseDraft,
  type ExpenseSummary,
} from "../domain/index.ts";
import type { ExpenseRepository } from "../repositories/expense-repository.ts";
import type { AiService } from "./ai-service.ts";
import type { FirebaseService } from "./firebase-service.ts";

const DISCORD_MESSAGE_LIMIT = 2000;
const LOW_CONFIDENCE = 0.6;

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
    if (!content) return;

    if (!ai.isEnabled()) {
      await msg.reply("ยังตอบไม่ได้ครับ ยังไม่ได้ตั้งค่า GEMINI_API_KEY");
      return;
    }

    // ยิง typing indicator ค้างไว้ระหว่างรอ AI (Discord หมดอายุให้เองใน 10 วิ)
    if (msg.channel.isSendable()) {
      void msg.channel.sendTyping().catch(() => {});
    }

    try {
      await reply(msg, await route(msg, content));
    } catch (err: unknown) {
      console.error("Failed to answer:", err);
      await reply(msg, "ขออภัยครับ ตอนนี้ทำรายการไม่สำเร็จ ลองใหม่อีกครั้งนะครับ");
    }
  }

  async function route(msg: Message, content: string): Promise<string> {
    const interpretation = await ai.interpret(content);

    switch (interpretation.intent) {
      case "log_expense": {
        if (!firebase.isEnabled()) {
          return `${formatDrafts(interpretation.expenses)}\n\n_ยังไม่ได้บันทึก: Firebase ยังไม่ได้ตั้งค่า_`;
        }
        const saved = await expenses.saveMany(interpretation.expenses, {
          userId: msg.author.id,
          sourceText: content,
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
        return ai.ask(content);
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
