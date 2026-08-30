import type { CollectionReference, Query } from "firebase-admin/firestore";
import type { Config } from "../config.ts";
import {
  isExpenseCategory,
  type CategoryTotal,
  type Expense,
  type ExpenseCategory,
  type ExpenseDraft,
  type ExpenseQuery,
  type ExpenseSummary,
} from "../domain/index.ts";
import type { FirebaseService } from "../services/firebase-service.ts";

/** Exactly what one Firestore document holds. */
type ExpenseDocument = {
  userId: string;
  item: string;
  amount: number;
  currency: "THB";
  category: ExpenseCategory;
  note: string | null;
  /** YYYY-MM-DD — a plain string so range filters sort lexicographically. */
  occurredAt: string;
  confidence: number;
  sourceText: string;
  createdAt: string;
};

export function createExpenseRepository(
  firebase: FirebaseService,
  config: Config,
) {
  function collection(): CollectionReference {
    return firebase.firestore().collection(config.firestoreCollection);
  }

  return {
    async saveMany(
      drafts: ExpenseDraft[],
      meta: { userId: string; sourceText: string },
    ): Promise<Expense[]> {
      const db = firebase.firestore();
      const batch = db.batch();
      const createdAt = new Date().toISOString();

      const saved = drafts.map((draft) => {
        const ref = collection().doc();
        const document: ExpenseDocument = {
          userId: meta.userId,
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
      query: ExpenseQuery,
      userId: string,
    ): Promise<ExpenseSummary> {
      let firestoreQuery: Query = collection()
        .where("userId", "==", userId)
        .where("occurredAt", ">=", query.from)
        .where("occurredAt", "<=", query.to);

      if (query.category) {
        firestoreQuery = firestoreQuery.where("category", "==", query.category);
      }

      const snapshot = await firestoreQuery.get();
      const totals = new Map<ExpenseCategory, CategoryTotal>();
      let total = 0;

      for (const document of snapshot.docs) {
        const data = document.data();
        const amount = Number(data["amount"]);
        if (!Number.isFinite(amount)) continue;

        const rawCategory = data["category"];
        const category: ExpenseCategory =
          typeof rawCategory === "string" && isExpenseCategory(rawCategory)
            ? rawCategory
            : "other";

        total += amount;
        const current = totals.get(category);
        if (current) {
          current.total += amount;
          current.count += 1;
        } else {
          totals.set(category, { category, total: amount, count: 1 });
        }
      }

      return {
        query,
        total,
        count: snapshot.size,
        currency: "THB",
        byCategory: [...totals.values()].sort((a, b) => b.total - a.total),
      };
    },
  };
}

export type ExpenseRepository = ReturnType<typeof createExpenseRepository>;
