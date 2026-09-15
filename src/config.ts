export const config = {
  port: Number(process.env.PORT ?? 3100),
  env: process.env.NODE_ENV ?? "development",
  discordToken: process.env.DISCORD_TOKEN ?? "",
  discordChannelId: process.env.CHANNEL_ID ?? "",
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite",
  /** portal-penny's create endpoint. Inside Docker, localhost is the container itself. */
  transactionsApiUrl:
    process.env.TRANSACTIONS_API_URL ?? "http://localhost:8000/api/transactions",
  /** Must match PENNY_API_TOKEN in portal-penny. */
  transactionsApiToken: process.env.PENNY_API_TOKEN ?? "",
  timezone: process.env.TIMEZONE ?? "Asia/Bangkok",
} as const;

export type Config = typeof config;
