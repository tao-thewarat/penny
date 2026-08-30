import { config } from "../config.ts";
import { createAiService } from "../services/ai-service.ts";

const prompt = process.argv.slice(2).join(" ").trim();
if (!prompt) {
  console.error('Usage: yarn ask "คำถามของคุณ"');
  process.exit(1);
}

const ai = createAiService(config);
console.log(`[${ai.model}] ${prompt}\n`);
console.log(await ai.ask(prompt));
