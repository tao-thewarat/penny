import type { EntryCategory } from "./entry-category.ts";

export type Currency = "THB";

/** Which way the money moved. `amount` is always positive; this carries the sign. */
export type EntryType = "expense" | "income";

/**
 * What the AI managed to read out of one chat message.
 * No id and no timestamps yet — those belong to the database layer.
 */
export type EntryDraft = {
  type: EntryType;
  /** What was bought or where the money came from. e.g. "ก๋วยเตี๋ยว", "เงินเดือน" */
  item: string;
  /** Always positive — read `type` for the direction. */
  amount: number;
  currency: Currency;
  /** Always drawn from the list matching `type`. */
  category: EntryCategory;
  /** Anything extra worth keeping, or null. */
  note: string | null;
  /** ISO date (YYYY-MM-DD) the money moved. */
  occurredAt: string;
  /** How sure the model is, 0–1. Low values are worth confirming with the user. */
  confidence: number;
};

/** A draft once it has been persisted. The database owns every added field. */
export type Entry = EntryDraft & {
  id: string;
  /** Discord user id of whoever logged it. */
  userId: string;
  /** The original message, kept so a bad parse can be re-read later. */
  sourceText: string;
  createdAt: string;
};

/** What the AI decided a single chat message is asking for. */
export type Interpretation =
  | { intent: "log_entry"; entries: EntryDraft[] }
  | { intent: "query_entries"; query: EntryQuery }
  | { intent: "chat"; reason: string };

/** A date range the user asked about, already resolved to absolute dates. */
export type EntryQuery = {
  /** ISO date, inclusive. */
  from: string;
  /** ISO date, inclusive. */
  to: string;
  /** null means both sides of the ledger. */
  type: EntryType | null;
  /** null means every category. */
  category: EntryCategory | null;
  /** How the user phrased the range, e.g. "เดือนนี้". Used when replying. */
  label: string;
};

export type CategoryTotal = {
  category: EntryCategory;
  total: number;
  count: number;
};

/** One side of the ledger over the queried range. */
export type EntryTotals = {
  total: number;
  count: number;
  byCategory: CategoryTotal[];
};

/**
 * Totals are summed in code, never by the model — money must not depend on
 * an LLM doing arithmetic.
 */
export type EntrySummary = {
  query: EntryQuery;
  currency: Currency;
  income: EntryTotals;
  expense: EntryTotals;
  /** income.total − expense.total. Negative means overspending. */
  net: number;
};
