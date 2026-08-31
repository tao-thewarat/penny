import type {
  CollectionReference,
  DocumentData,
  Query,
} from "firebase-admin/firestore";
import type { Config } from "../config.ts";
import {
  isCategoryFor,
  type CategoryTotal,
  type Entry,
  type EntryCategory,
  type EntryDraft,
  type EntryQuery,
  type EntrySummary,
  type EntryTotals,
  type EntryType,
} from "../domain/index.ts";
import type { FirebaseService } from "../services/firebase-service.ts";

/** Exactly what one Firestore document holds. */
type EntryDocument = {
  userId: string;
  /**
   * Written since income support landed. Documents saved before that have no
   * `type` at all and are read back as expenses — see `toEntryType`.
   */
  type: EntryType;
  item: string;
  /** Always positive; `type` carries the direction. */
  amount: number;
  currency: "THB";
  category: EntryCategory;
  note: string | null;
  /** YYYY-MM-DD — a plain string so range filters sort lexicographically. */
  occurredAt: string;
  confidence: number;
  sourceText: string;
  createdAt: string;
};

export function createEntryRepository(
  firebase: FirebaseService,
  config: Config,
) {
  function collection(): CollectionReference {
    return firebase.firestore().collection(config.firestoreCollection);
  }

  return {
    async saveMany(
      drafts: EntryDraft[],
      meta: { userId: string; sourceText: string },
    ): Promise<Entry[]> {
      const db = firebase.firestore();
      const batch = db.batch();
      const createdAt = new Date().toISOString();

      const saved = drafts.map((draft) => {
        const ref = collection().doc();
        const document: EntryDocument = {
          userId: meta.userId,
          type: draft.type,
          item: draft.item,
          amount: draft.amount,
          currency: draft.currency,
          category: draft.category,
          note: draft.note,
          occurredAt: draft.occurredAt,
          confidence: draft.confidence,
          sourceText: meta.sourceText,
          createdAt,
        };
        batch.set(ref, document);
        return { id: ref.id, ...document };
      });

      await batch.commit();
      return saved;
    },

    async summarise(
      query: EntryQuery,
      userId: string,
    ): Promise<EntrySummary> {
      const documents = await readForSummary(collection(), query, userId);

      const income = createTally();
      const expense = createTally();

      for (const data of documents) {
        const amount = Math.abs(Number(data["amount"]));
        if (!Number.isFinite(amount)) continue;

        const type = toEntryType(data["type"]);
        // The type filter is applied here rather than in Firestore so that no
        // extra composite index is needed — see readForSummary.
        if (query.type && type !== query.type) continue;

        add(type === "income" ? income : expense, toCategory(data["category"], type), amount);
      }

      return {
        query,
        currency: "THB",
        income: toTotals(income),
        expense: toTotals(expense),
        net: income.total - expense.total,
      };
    },
  };
}

type Tally = {
  total: number;
  count: number;
  byCategory: Map<EntryCategory, CategoryTotal>;
};

function createTally(): Tally {
  return { total: 0, count: 0, byCategory: new Map() };
}

function add(tally: Tally, category: EntryCategory, amount: number): void {
  tally.total += amount;
  tally.count += 1;

  const current = tally.byCategory.get(category);
  if (current) {
    current.total += amount;
    current.count += 1;
  } else {
    tally.byCategory.set(category, { category, total: amount, count: 1 });
  }
}

function toTotals(tally: Tally): EntryTotals {
  return {
    total: tally.total,
    count: tally.count,
    byCategory: [...tally.byCategory.values()].sort((a, b) => b.total - a.total),
  };
}

/** Documents written before income support carry no `type`; they are expenses. */
function toEntryType(value: unknown): EntryType {
  return value === "income" ? "income" : "expense";
}

function toCategory(value: unknown, type: EntryType): EntryCategory {
  return typeof value === "string" && isCategoryFor(value, type)
    ? (value as EntryCategory)
    : type === "income"
      ? "other_income"
      : "other";
}

/** Firestore's FAILED_PRECONDITION, which is how a missing index arrives. */
const FAILED_PRECONDITION = 9;

let warnedAboutIndex = false;

/**
 * The narrow query needs a composite index (see firestore.indexes.json). A
 * fresh project has none, and Firestore then rejects every summary rather than
 * answering slowly — which read as "the bot is broken" to the user.
 *
 * So a missing index falls back to an equality-only query, which Firestore
 * serves from the automatic single-field indexes, and the range is applied
 * here. It reads that one user's whole history, so it is a stopgap, not the
 * plan: `yarn indexes` restores the indexed path.
 *
 * `query.type` is deliberately not pushed down — filtering it in memory keeps
 * the existing two indexes sufficient, and the range has already narrowed the
 * result set by then.
 */
async function readForSummary(
  entries: CollectionReference,
  query: EntryQuery,
  userId: string,
): Promise<DocumentData[]> {
  let indexed: Query = entries
    .where("userId", "==", userId)
    .where("occurredAt", ">=", query.from)
    .where("occurredAt", "<=", query.to);

  if (query.category) {
    indexed = indexed.where("category", "==", query.category);
  }

  try {
    return (await indexed.get()).docs.map((document) => document.data());
  } catch (err: unknown) {
    if (!isMissingIndex(err)) throw err;

    if (!warnedAboutIndex) {
      warnedAboutIndex = true;
      console.warn(
        "Firestore has no composite index for the summary query, falling back to a full per-user read. Run `yarn indexes` to fix it.",
      );
    }

    const snapshot = await entries.where("userId", "==", userId).get();

    return snapshot.docs
      .map((document) => document.data())
      .filter((data) => {
        const occurredAt = data["occurredAt"];
        if (typeof occurredAt !== "string") return false;
        if (occurredAt < query.from || occurredAt > query.to) return false;
        return !query.category || data["category"] === query.category;
      });
  }
}

function isMissingIndex(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const record = err as { code?: unknown; message?: unknown };
  return (
    record.code === FAILED_PRECONDITION &&
    typeof record.message === "string" &&
    record.message.includes("index")
  );
}

export type EntryRepository = ReturnType<typeof createEntryRepository>;
