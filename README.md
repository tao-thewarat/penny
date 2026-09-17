# Penny

A Discord bot that turns everyday chat messages into a personal money log —
both what you spend and what you earn.

Type `ก๋วยเตี๋ยว 60` in a channel and Penny reads it as a 60 THB food expense,
categorises it, and sends it to [portal-penny](https://github.com/tao-thewarat/portal-penny).
Type `เงินเดือน 30000` and it files that as salary income instead. Drop in a
photo of a receipt or a bank transfer slip and it reads the total off the
picture. Totals and history live in the portal's web UI.

```
you   ก๋วยเตี๋ยว 60
penny 🍜 ก๋วยเตี๋ยว — -60 THB
         Food & Drink · 2026-08-30
      _บันทึกแล้ว 1 รายการ_

you   เงินเดือน 30000
penny 💵 เงินเดือน — +30,000 THB
         Salary · 2026-08-30
      _บันทึกแล้ว 1 รายการ_

you   [7-eleven-slip.jpg]
penny 🛒 7-Eleven — -128 THB (ref 0043 · นม, ขนมปัง)
         Groceries · 2026-08-30
      _บันทึกแล้ว 1 รายการ_

you   เดือนนี้เหลือเท่าไหร่
penny ดูสรุปรายรับรายจ่ายได้ที่ http://localhost:8000/transactions/ ครับ
```

## How it works

Every message goes through one Gemini call that decides what the message *is*,
then the app does the rest:

| Intent | What the model returns | What the app does |
| --- | --- | --- |
| `log_entry` | direction, item, amount, category, date | POSTs each entry to portal-penny |
| `query_entries` | an absolute `from`/`to` range, optional side | links to the portal's summary page |
| `chat` | nothing | replies with a normal chat answer |

Every entry carries a `type` of `expense` or `income`, and `amount` is always
positive — the type is what carries the sign. The model picks the direction from
the wording (`เงินเดือน`, `ได้โบนัส`, `เงินเข้า` are income; a bare *item +
number* defaults to an expense), and each direction has its own category list,
so an income row can never end up filed as `food_and_drink`.

The `chat` branch writes nothing, and its prompt says so explicitly — otherwise
the model happily answers *"บันทึกให้แล้ว"* for something it never saved.

**The model never touches the arithmetic.** The bot holds no data and answers
no totals; the portal sums in SQL. `query_entries` is still detected so that a
question about money gets a link, not a chat reply with invented numbers.

Images ride along the same call. Attachments Gemini can read (png, jpeg, webp,
heic/heif — up to 4 per message, 8 MB each) are downloaded from Discord and sent
inline with the message, and the prompt gains a block of receipt rules: take the
printed grand total rather than summing lines, read the slip's own date, convert
Buddhist years. Anything the user types alongside the image wins over the image.

The model is also not connected to any storage. It only ever sees the message text and any attached pictures, and returns
structured JSON, constrained by a response schema. Every field is re-validated before it reaches the rest of the
app, because a schema constrains the model without guaranteeing it.

## Layout

```
src/
  index.ts                        composition root: wire, start, graceful shutdown
  config.ts                       all env access, in one place
  domain/
    entry.ts                      Entry, EntryDraft, EntryQuery, EntryType
    entry-category.ts             the expense + income category seeds; the id unions derive from them
  services/
    ai-service.ts                 Gemini: interpret() and ask()
    discord-service.ts            client, intent routing, reply formatting
  repositories/
    entry-repository.ts           saveMany(): POST to portal-penny
  scripts/                        CLI helpers for testing without Discord
```

Services are plain factory functions that take their dependencies as arguments,
wired together in `services/index.ts`. No DI framework, and every service can be
constructed with a stub config in a test.

Adding a category means adding one entry to `EXPENSE_CATEGORIES` or
`INCOME_CATEGORIES` — the TypeScript unions, the AI response schema, and the
display labels all derive from those arrays.

## Requirements

- Node 22.18+ (this project runs `.ts` files directly via Node's built-in type
  stripping — no `ts-node` or `tsx`)
- Yarn
- A Discord bot token
- A Google AI Studio API key (the free tier is enough)
- [portal-penny](https://github.com/tao-thewarat/portal-penny) running (default
  `http://localhost:8000`)

## Setup

```bash
yarn install
cp .env.example .env.local   # local development: yarn dev, parse, ask
cp .env.example .env         # yarn start and Docker
```

`yarn dev`, `yarn parse` and `yarn ask` read `.env.local`; `yarn start` reads
`.env`. Both are gitignored. Fill in whichever you are running:

| Variable | Where it comes from |
| --- | --- |
| `DISCORD_TOKEN` | Discord Developer Portal → Bot |
| `CHANNEL_ID` | right-click the channel → Copy Channel ID |
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey |
| `GEMINI_MODEL` | defaults to `gemini-3.5-flash-lite` |
| `TRANSACTIONS_API_URL` | defaults to `http://localhost:8000/api/transactions` |
| `PENNY_API_TOKEN` | any long random string — the same value in portal-penny's `.env` |

The bot needs the **Message Content** privileged intent enabled in the Discord
Developer Portal.

### Connecting to portal-penny

The bot sends `Authorization: Bearer $PENNY_API_TOKEN` with every save, and the
portal compares it against its own `PENNY_API_TOKEN`. Generate one value and put
it in both `.env` files:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

If the portal has no token set it refuses every save, so a forgotten value fails
loudly instead of leaving the endpoint open.

Running the bot in Docker? `localhost` inside the container is the container
itself. Point it at the host instead:

```bash
docker run --add-host=host.docker.internal:host-gateway \
  -e TRANSACTIONS_API_URL=http://host.docker.internal:8000/api/transactions ...
```

## Running

```bash
yarn dev        # watch mode, runs src/ directly, reads .env.local
yarn build      # compile to dist/
yarn start      # run the compiled build, reads .env
yarn typecheck
```

On startup Penny prints which integrations are live, so a missing key is
obvious immediately:

```
penny running in development (port 3100)
AI enabled: gemini-3.5-flash-lite
Transactions API: http://localhost:8000/api/transactions
Discord bot online: penny#0000
```

Each integration degrades on its own: without a Gemini key the bot still
connects to Discord, and without `PENNY_API_TOKEN` it warns at startup — every
save would be rejected by the portal.

## Testing without Discord

```bash
yarn parse "เมื่อวานแท็กซี่ไปสนามบิน 350 กับกาแฟ 85"
yarn parse ./slip.jpg                 # image only
yarn parse "จ่ายค่าข้าว" ./slip.jpg    # text + image
yarn parse "เงินเดือน 30000"           # income
yarn ask "สวัสดี ทำอะไรได้บ้าง"
```

`parse` prints the raw interpretation as JSON and never calls the portal,
which makes it the fastest way to check a prompt change.

## Data model

One `POST /api/transactions` per entry, with the body portal-penny's
`PaymentTransactionSerializer` expects:

```ts
{
  name: string          // "ก๋วยเตี๋ยว"
  user_id: string       // Discord user id
  type: string          // "expense" | "income"
  amount: number        // 60 — always positive, `type` carries the direction
  currency: "THB"
  category: string      // "food_and_drink" for expenses, "salary" for income
  note: string | null
  occurred_at: string   // "2026-08-30"
  confidence: number    // 0–1, from the model
  source_text: string   // the original message, kept so a bad parse can be re-read
                        // image-only messages are sent as "[รูปภาพ N รูป]"
  created_at: string    // ISO timestamp
}
```

The portal answers `201` with the stored row. A message holding several entries
is sent one entry at a time; if one fails part-way, the bot replies with what did
save so a retry does not duplicate it. Entries already in Firestore are not
migrated.
