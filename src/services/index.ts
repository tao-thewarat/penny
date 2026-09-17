import type { Config } from '../config.ts'
import { createEntryRepository } from '../repositories/entry-repository.ts'
import { createImageRepository } from '../repositories/image-repository.ts'
import { createAiService } from './ai-service.ts'
import { createDiscordService } from './discord-service.ts'

export function createServices(config: Config) {
  const ai = createAiService(config)
  const entries = createEntryRepository(config)
  const image = createImageRepository(config)
  const discord = createDiscordService(config, ai, entries, image)

  return { ai, entries, discord }
}

export type Services = ReturnType<typeof createServices>
