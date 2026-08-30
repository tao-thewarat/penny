/**
 * Node's --env-file strips surrounding quotes, Docker's --env-file does not,
 * so a key written as FIREBASE_PRIVATE_KEY="...\n..." arrives quoted in a
 * container and fails to parse. Strip the wrapping pair before unescaping.
 */
function readMultilineSecret(raw: string): string {
  return raw.replace(/^\s*(['"])([\s\S]*)\1\s*$/, "$2").replace(/\\n/g, "\n");
}

export const config = {
  port: Number(process.env.PORT ?? 3100),
  env: process.env.NODE_ENV ?? "development",
  discordToken: process.env.DISCORD_TOKEN ?? "",
  discordChannelId: process.env.CHANNEL_ID ?? "",
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite",
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID ?? "",
  firebaseClientEmail: process.env.FIREBASE_CLIENT_EMAIL ?? "",
  firebasePrivateKey: readMultilineSecret(process.env.FIREBASE_PRIVATE_KEY ?? ""),
  firestoreCollection: process.env.FIRESTORE_COLLECTION ?? "expenses",
  timezone: process.env.TIMEZONE ?? "Asia/Bangkok",
} as const;

export type Config = typeof config;
