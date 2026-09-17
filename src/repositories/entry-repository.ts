import type { Config } from '../config.ts'
import type {
  Currency,
  Entry,
  EntryCategory,
  EntryDraft,
  EntryType,
} from '../domain/index.ts'

/** Exactly what portal-penny's PaymentTransactionSerializer accepts. */
type TransactionPayload = {
  name: string
  user_id: string
  type: EntryType
  /** Always positive; `type` carries the direction. */
  amount: number
  currency: Currency
  category: EntryCategory
  note: string | null
  /** YYYY-MM-DD */
  occurred_at: string
  confidence: number
  source_text: string
  created_at: string
  image_keys: string[]
}

/** The id is the only field the portal adds that the bot does not already hold. */
type TransactionResponse = {
  success?: boolean
  data?: { id?: unknown }
}

const REQUEST_TIMEOUT_MS = 10_000

/**
 * The API creates one transaction per request, so a message with several
 * entries can fail part-way. `saved` holds the ones that did go through, so the
 * reply can say so instead of inviting a retry that duplicates them.
 */
export class SaveEntriesError extends Error {
  readonly saved: Entry[]

  constructor(message: string, saved: Entry[], options?: ErrorOptions) {
    super(message, options)
    this.name = 'SaveEntriesError'
    this.saved = saved
  }
}

export function createEntryRepository(config: Config) {
  async function post(payload: TransactionPayload): Promise<string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
    }
    if (config.transactionsApiToken) {
      headers['authorization'] = `Bearer ${config.transactionsApiToken}`
    }

    const response = await fetch(config.transactionsApiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      // Django answers an unauthenticated call with a 302 to its login page;
      // following it would turn the failure into a confusing HTML 200.
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    const body = await response.text()
    if (response.status !== 201) {
      throw new Error(
        `POST ${config.transactionsApiUrl} returned HTTP ${response.status}: ${body.slice(0, 500)}`,
      )
    }

    const parsed = parseResponse(body)
    const id = parsed?.data?.id
    if (
      parsed?.success !== true ||
      (typeof id !== 'number' && typeof id !== 'string')
    ) {
      throw new Error(
        `Unexpected response from ${config.transactionsApiUrl}: ${body.slice(0, 500)}`,
      )
    }
    return String(id)
  }

  return {
    async saveMany(
      drafts: EntryDraft[],
      meta: { userId: string; sourceText: string; slipKeys: string[] },
    ): Promise<Entry[]> {
      const createdAt = new Date().toISOString()
      const saved: Entry[] = []

      // One at a time, so a failure leaves a known prefix saved rather than an
      // unknown subset.
      for (const draft of drafts) {
        try {
          const id = await post({
            name: draft.item,
            user_id: meta.userId,
            type: draft.type,
            amount: draft.amount,
            currency: draft.currency,
            category: draft.category,
            note: draft.note,
            occurred_at: draft.occurredAt,
            confidence: draft.confidence,
            source_text: meta.sourceText,
            created_at: createdAt,
            image_keys: meta.slipKeys,
          })
          saved.push({
            ...draft,
            id,
            userId: meta.userId,
            sourceText: meta.sourceText,
            createdAt,
          })
        } catch (err: unknown) {
          throw new SaveEntriesError(
            `Saved ${saved.length} of ${drafts.length} entries`,
            saved,
            { cause: err },
          )
        }
      }

      return saved
    },
  }
}

function parseResponse(body: string): TransactionResponse | undefined {
  try {
    const value: unknown = JSON.parse(body)
    return typeof value === 'object' && value !== null
      ? (value as TransactionResponse)
      : undefined
  } catch {
    return undefined
  }
}

export type EntryRepository = ReturnType<typeof createEntryRepository>
