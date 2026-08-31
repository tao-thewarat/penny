# Penny

A Discord bot that turns everyday chat messages into a personal money log —
both what you spend and what you earn.

Type `ก๋วยเตี๋ยว 60` in a channel and Penny reads it as a 60 THB food expense,
categorises it, and writes it to Firestore. Type `เงินเดือน 30000` and it files
that as salary income instead. Drop in a photo of a receipt or a bank transfer
slip and it reads the total off the picture. Ask `เดือนนี้เหลือเท่าไหร่` and it
answers with the real numbers from the database.

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
penny 📊 เดือนนี้ (2026-08-01 → 2026-08-31)
      💰 รายรับ 30,000 THB จาก 1 รายการ
      💸 รายจ่าย 495 THB จาก 3 รายการ
      🧮 คงเหลือ +29,505 THB

      __รายรับ__
      💵 Salary — 30,000 (1)

      __รายจ่าย__
      🚗 Transport — 350 (1)
      🍜 Food & Drink — 145 (2)
```

## How it works

Every message goes through one Gemini call that decides what the message *is*,
then the app does the rest:

| Intent | What the model returns | What the app does |
| --- | --- | --- |
| `log_entry` | direction, item, amount, category, date | writes the rows to Firestore |
| `query_entries` | an absolute `from`/`to` range, optional side | queries Firestore, sums in code |
| `chat` | nothing | replies with a normal chat answer |

Every entry carries a `type` of `expense` or `income`, and `amount` is always
positive — the type is what carries the sign. The model picks the direction from
the wording (`เงินเดือน`, `ได้โบนัส`, `เงินเข้า` are income; a bare *item +
number* defaults to an expense), and each direction has its own category list,
so an income row can never end up filed as `food_and_drink`.

The `chat` branch writes nothing, and its prompt says so explicitly — otherwise
the model happily answers *"บันทึกให้แล้ว"* for something it never saved.

**The model never touches the arithmetic.** It resolves language — *"เดือนนี้"*
into `2026-08-01 → 2026-08-31` — and the application sums the amounts itself.
An LLM that quietly adds wrong is far worse than one that fails loudly, so
totals stay in code where they can be tested.

Images ride along the same call. Attachments Gemini can read (png, jpeg, webp,
heic/heif — up to 4 per message, 8 MB each) are downloaded from Discord and sent
inline with the message, and the prompt gains a block of receipt rules: take the
printed grand total rather than summing lines, read the slip's own date, convert
Buddhist years. Anything the user types alongside the image wins over the image.

The model is also not connected to the database. It cannot read Firestore; it
only ever sees the message text and any attached pictures, and returns
structured JSON, constrained by a response schema. Every field is re-validated before it reaches the rest of the
app, because a schema constrains the model without guaranteeing it.

## Layout

```
src/
  index.ts                        composition root: wire, start, graceful shutdown
  config.ts                       all env access, in one place
  domain/
    entry.ts                      Entry, EntryDraft, EntryQuery, EntrySummary, EntryType
    entry-category.ts             the expense + income category seeds; the id unions derive from them
  services/
    ai-service.ts                 Gemini: interpret() and ask()
    discord-service.ts            client, intent routing, reply formatting
    firebase-service.ts           lazy Firestore init
  repositories/
    entry-repository.ts           saveMany() and summarise()
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
- A Firebase project with Firestore enabled

## Setup

```bash
yarn install
cp .env.example .env
```

Fill in `.env`:

| Variable | Where it comes from |
| --- | --- |
| `DISCORD_TOKEN` | Discord Developer Portal → Bot |
| `CHANNEL_ID` | right-click the channel → Copy Channel ID |
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey |
| `GEMINI_MODEL` | defaults to `gemini-3.5-flash-lite` |
| `FIREBASE_PROJECT_ID` | Firebase console → Project settings |
| `FIREBASE_CLIENT_EMAIL` | from the service account JSON |
| `FIREBASE_PRIVATE_KEY` | from the service account JSON |

The bot needs the **Message Content** privileged intent enabled in the Discord
Developer Portal.

For Firebase, generate a key under **Project settings → Service accounts →
Generate new private key** and copy two fields out of the JSON. Keep the private
key on one line, wrapped in double quotes, with `\n` left as two literal
characters:

```
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEv...\n-----END PRIVATE KEY-----\n"
```

`config.ts` converts those back into real newlines at startup.

> The web app config from the Firebase console (`apiKey`, `authDomain`, …) will
> not work here. That config authenticates a browser user; a server needs a
> service account.

### Firestore indexes

Summary queries filter on `userId` and a date range at once, which Firestore
serves from a composite index. Create the ones in `firestore.indexes.json` with
the service account you already configured:

```bash
yarn indexes
```

If that returns `PERMISSION_DENIED`, the service account needs the **Cloud
Datastore Index Admin** role (`roles/datastore.indexAdmin`) — the command
prints the IAM link. The Firebase CLI
(`npx firebase-tools deploy --only firestore:indexes`) and the one-click link in
the console both work too. Indexes take a minute or two to build.

**Summaries answer either way.** Without an index the app falls back to reading
that one user's entries and filtering the range in code, and logs a warning.
That is a stopgap for a fresh project, not the plan — it reads the user's whole
history on every question, so create the indexes once the bot is real.

## Running

```bash
yarn dev        # watch mode, runs src/ directly
yarn build      # compile to dist/
yarn start      # run the compiled build
yarn typecheck
yarn indexes    # create the Firestore composite indexes
```

On startup Penny prints which integrations are live, so a missing key is
obvious immediately:

```
penny running in development (port 3100)
AI enabled: gemini-3.5-flash-lite
Firestore enabled: collection "expenses"
Discord bot online: penny#0000
```

Each integration degrades on its own: without a Gemini key the bot still
connects to Discord, and without Firebase credentials it still parses messages
but says it could not save them.

## Testing without Discord

```bash
yarn parse "เมื่อวานแท็กซี่ไปสนามบิน 350 กับกาแฟ 85"
yarn parse ./slip.jpg                 # image only
yarn parse "จ่ายค่าข้าว" ./slip.jpg    # text + image
yarn parse "เงินเดือน 30000"           # income
yarn summary <discord-user-id> "เดือนนี้เหลือเท่าไหร่"
yarn ask "สวัสดี ทำอะไรได้บ้าง"
```

`parse` prints the raw interpretation as JSON and never touches the database,
which makes it the fastest way to check a prompt change.

## Data model

One Firestore document per entry, in the `expenses` collection:

```ts
{
  userId: string        // Discord user id
  type: string          // "expense" | "income"
  item: string          // "ก๋วยเตี๋ยว"
  amount: number        // 60 — always positive, `type` carries the direction
  currency: "THB"
  category: string      // "food_and_drink" for expenses, "salary" for income
  note: string | null
  occurredAt: string    // "2026-08-30", a plain string so ranges sort lexicographically
  confidence: number    // 0–1, from the model
  sourceText: string    // the original message, kept so a bad parse can be re-read
                        // image-only messages are stored as "[รูปภาพ N รูป]"
  createdAt: string
}
```

Documents written before income support have no `type` field; they are read
back as expenses, so no backfill is needed. The collection is still named
`expenses` (override with `FIRESTORE_COLLECTION`) so existing data keeps
working.
