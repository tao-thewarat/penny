import { config } from "./config.ts";
import { createServices, type Services } from "./services/index.ts";

async function main(): Promise<void> {
  const services = createServices(config);

  console.log(`penny running in ${config.env} (port ${config.port})`);
  console.log(
    services.ai.isEnabled()
      ? `AI enabled: ${services.ai.model}`
      : "AI disabled: GEMINI_API_KEY is not set",
  );
  console.log(`Transactions API: ${config.transactionsApiUrl}`);
  if (!config.transactionsApiToken) {
    console.warn("PENNY_API_TOKEN is not set: the portal will reject every save");
  }

  await services.discord.start();

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void shutdown(services, signal);
    });
  }
}

async function shutdown(services: Services, signal: string): Promise<void> {
  console.log(`\nReceived ${signal}, shutting down...`);
  await services.discord.stop();
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
