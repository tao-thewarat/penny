import type { ExpenseCategory } from "./expense-category.ts";

export type Currency = "THB";

/**
 * What the AI managed to read out of one chat message.
 * No id and no timestamps yet — those belong to the database layer.
 */
export type ExpenseDraft = {
  /** What was bought, normalised. e.g. "ก๋วยเตี๋ยว" */
  item: string;
  amount: number;
  currency: Currency;
  category: ExpenseCategory;
  /** Anything extra worth keeping, or null. */
  note: string | null;
  /** ISO date (YYYY-MM-DD) the money was spent. */
  occurredAt: string;
  /** How sure the model is, 0–1. Low values are worth confirming with the user. */
  confidence: number;
};

/** A draft once it has been persisted. The database owns every added field. */
export type Expense = ExpenseDraft & {
  id: string;
  /** Discord user id of whoever logged it. */
  userId: string;
  /** The original message, kept so a bad parse can be re-read later. */
  sourceText: string;
  createdAt: string;
};

/** What the AI decided a single chat message is asking for. */
export type Interpretation =
  | { intent: "log_expense"; expenses: ExpenseDraft[] }
  | { intent: "query_expenses"; query: ExpenseQuery }
  | { intent: "chat"; reason: string };

/** A date range the user asked about, already resolved to absolute dates. */
export type ExpenseQuery = {
  /** ISO date, inclusive. */
  from: string;
  /** ISO date, inclusive. */
  to: string;
  /** null means every category. */
  category: ExpenseCategory | null;
  /** How the user phrased the range, e.g. "เดือนนี้". Used when replying. */
  label: string;
};

export type CategoryTotal = {
  category: ExpenseCategory;
  total: number;
  count: number;
};

/**
 * Totals are summed in code, never by the model — money must not depend on
 * an LLM doing arithmetic.
 */
export type ExpenseSummary = {
  query: ExpenseQuery;
  total: number;
  count: number;
  currency: Currency;
  byCategory: CategoryTotal[];
};
