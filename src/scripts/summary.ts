import { config } from "../config.ts";
import { createEntryRepository } from "../repositories/entry-repository.ts";
import { createAiService } from "../services/ai-service.ts";
import { formatSummary } from "../services/discord-service.ts";
import { createFirebaseService } from "../services/firebase-service.ts";

const [userId, ...rest] = process.argv.slice(2);
const question = rest.join(" ").trim();

if (!userId || !question) {
  console.error('Usage: yarn summary <discordUserId> "เดือนนี้ใช้ไปเท่าไหร่"');
  process.exit(1);
}

const ai = createAiService(config);
const firebase = createFirebaseService(config);
const entries = createEntryRepository(firebase, config);

const interpretation = await ai.interpret(question);
if (interpretation.intent !== "query_entries") {
  console.error(`ไม่ใช่คำถามเรื่องยอดเงิน (intent=${interpretation.intent})`);
  process.exit(1);
}

console.log(formatSummary(await entries.summarise(interpretation.query, userId)));
