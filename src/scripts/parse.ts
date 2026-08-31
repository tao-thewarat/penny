import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.ts";
import { createAiService, type ImageInput } from "../services/ai-service.ts";
import { formatDrafts } from "../services/discord-service.ts";

const IMAGE_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

const args = process.argv.slice(2);
const imagePaths = args.filter(
  (arg) => IMAGE_MIME_TYPES[path.extname(arg).toLowerCase()] !== undefined,
);
const message = args
  .filter((arg) => !imagePaths.includes(arg))
  .join(" ")
  .trim();

if (!message && imagePaths.length === 0) {
  console.error('Usage: yarn parse "ก๋วยเตี๋ยว 60" [slip.jpg ...]');
  process.exit(1);
}

const images: ImageInput[] = await Promise.all(
  imagePaths.map(async (imagePath) => ({
    mimeType: IMAGE_MIME_TYPES[path.extname(imagePath).toLowerCase()] ?? "image/jpeg",
    data: Buffer.from(await readFile(imagePath)).toString("base64"),
  })),
);

const ai = createAiService(config);
const interpretation = await ai.interpret(message, images);

console.log(JSON.stringify(interpretation, null, 2));

if (interpretation.intent === "log_expense") {
  console.log(`\n${formatDrafts(interpretation.expenses)}`);
}
