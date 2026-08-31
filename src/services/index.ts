import type { Config } from "../config.ts";
import { createEntryRepository } from "../repositories/entry-repository.ts";
import { createAiService } from "./ai-service.ts";
import { createDiscordService } from "./discord-service.ts";
import { createFirebaseService } from "./firebase-service.ts";

export function createServices(config: Config) {
  const ai = createAiService(config);
  const firebase = createFirebaseService(config);
  const entries = createEntryRepository(firebase, config);
  const discord = createDiscordService(config, ai, firebase, entries);

  return { ai, firebase, entries, discord };
}

export type Services = ReturnType<typeof createServices>;
