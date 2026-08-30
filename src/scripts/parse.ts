import { config } from "../config.ts";
import { createAiService } from "../services/ai-service.ts";
import { formatDrafts } from "../services/discord-service.ts";

const message = process.argv.slice(2).join(" ").trim();
if (!message) {
  console.error('Usage: yarn parse "ก๋วยเตี๋ยว 60"');
  process.exit(1);
}

const ai = createAiService(config);
const interpretation = await ai.interpret(message);

console.log(JSON.stringify(interpretation, null, 2));

if (interpretation.intent === "log_expense") {
  console.log(`\n${formatDrafts(interpretation.expenses)}`);
}
