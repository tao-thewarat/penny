import type { Config } from "../config.ts";
import { createExpenseRepository } from "../repositories/expense-repository.ts";
import { createAiService } from "./ai-service.ts";
import { createDiscordService } from "./discord-service.ts";
import { createFirebaseService } from "./firebase-service.ts";

export function createServices(config: Config) {
  const ai = createAiService(config);
  const firebase = createFirebaseService(config);
  const expenses = createExpenseRepository(firebase, config);
  const discord = createDiscordService(config, ai, firebase, expenses);

  return { ai, firebase, expenses, discord };
}

export type Services = ReturnType<typeof createServices>;
