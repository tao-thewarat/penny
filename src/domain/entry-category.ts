import type { EntryType } from "./entry.ts";

/**
 * Seed lists of categories, one per direction of money.
 * `id` is the stable key stored in the database and returned by the AI —
 * never rename one without a migration. `label`/`emoji` are display only,
 * `hint` is fed to the model to disambiguate similar categories.
 */
export const EXPENSE_CATEGORIES = [
  {
    id: "food_and_drink",
    label: "Food & Drink",
    emoji: "🍜",
    hint: "Meals, snacks, coffee, restaurants, food delivery",
  },
  {
    id: "groceries",
    label: "Groceries",
    emoji: "🛒",
    hint: "Supermarket, fresh market, household supplies",
  },
  {
    id: "transport",
    label: "Transport",
    emoji: "🚗",
    hint: "Fuel, taxi, ride hailing, train, bus, parking, tolls",
  },
  {
    id: "shopping",
    label: "Shopping",
    emoji: "🛍️",
    hint: "Clothes, electronics, gadgets, general retail",
  },
  {
    id: "bills_and_utilities",
    label: "Bills & Utilities",
    emoji: "💡",
    hint: "Electricity, water, internet, mobile, subscriptions",
  },
  {
    id: "housing",
    label: "Housing",
    emoji: "🏠",
    hint: "Rent, mortgage, condo fees, home repairs",
  },
  {
    id: "health",
    label: "Health",
    emoji: "💊",
    hint: "Medicine, doctor, dentist, hospital, insurance",
  },
  {
    id: "entertainment",
    label: "Entertainment",
    emoji: "🎮",
    hint: "Games, movies, concerts, hobbies, streaming",
  },
  {
    id: "education",
    label: "Education",
    emoji: "📚",
    hint: "Courses, books, tuition, certifications",
  },
  {
    id: "travel",
    label: "Travel",
    emoji: "✈️",
    hint: "Flights, hotels, trips away from home",
  },
  {
    id: "personal_care",
    label: "Personal Care",
    emoji: "💇",
    hint: "Haircut, cosmetics, gym, spa",
  },
  {
    id: "gifts_and_donations",
    label: "Gifts & Donations",
    emoji: "🎁",
    hint: "Presents, charity, merit making, tips",
  },
  {
    id: "fees_and_charges",
    label: "Fees & Charges",
    emoji: "🏦",
    hint: "Bank fees, interest paid, taxes, fines, transfers out",
  },
  {
    id: "pets",
    label: "Pets",
    emoji: "🐶",
    hint: "Pet food, vet, grooming",
  },
  {
    id: "other",
    label: "Other",
    emoji: "📦",
    hint: "Any spending that does not fit the categories above",
  },
] as const satisfies readonly CategoryDefinition[];

export const INCOME_CATEGORIES = [
  {
    id: "salary",
    label: "Salary",
    emoji: "💵",
    hint: "Monthly salary, wages, regular pay from an employer",
  },
  {
    id: "bonus",
    label: "Bonus",
    emoji: "🎉",
    hint: "Bonus, commission, overtime pay, incentives",
  },
  {
    id: "freelance",
    label: "Freelance",
    emoji: "💼",
    hint: "Side jobs, contract work, gigs, tutoring",
  },
  {
    id: "business",
    label: "Business",
    emoji: "🏪",
    hint: "Sales, shop takings, profit from your own business",
  },
  {
    id: "investment",
    label: "Investment",
    emoji: "📈",
    hint: "Interest received, dividends, trading gains, rent collected",
  },
  {
    id: "gift_received",
    label: "Gift Received",
    emoji: "🧧",
    hint: "Money given by family or friends, red envelopes, allowance",
  },
  {
    id: "refund",
    label: "Refund",
    emoji: "↩️",
    hint: "Refunds, reimbursements, cashback, money paid back to you",
  },
  {
    id: "other_income",
    label: "Other Income",
    emoji: "💰",
    hint: "Any money received that does not fit the categories above",
  },
] as const satisfies readonly CategoryDefinition[];

export type CategoryDefinition = {
  id: string;
  label: string;
  emoji: string;
  hint: string;
};

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]["id"];
export type IncomeCategory = (typeof INCOME_CATEGORIES)[number]["id"];
export type EntryCategory = ExpenseCategory | IncomeCategory;

export const EXPENSE_CATEGORY_IDS: readonly ExpenseCategory[] =
  EXPENSE_CATEGORIES.map((category) => category.id);

export const INCOME_CATEGORY_IDS: readonly IncomeCategory[] =
  INCOME_CATEGORIES.map((category) => category.id);

/** Every id the model may return, expenses first. */
export const ENTRY_CATEGORY_IDS: readonly EntryCategory[] = [
  ...EXPENSE_CATEGORY_IDS,
  ...INCOME_CATEGORY_IDS,
];

const EXPENSE_BY_ID = new Map<string, CategoryDefinition>(
  EXPENSE_CATEGORIES.map((category) => [category.id, category]),
);

const INCOME_BY_ID = new Map<string, CategoryDefinition>(
  INCOME_CATEGORIES.map((category) => [category.id, category]),
);

export function isExpenseCategory(value: string): value is ExpenseCategory {
  return EXPENSE_BY_ID.has(value);
}

export function isIncomeCategory(value: string): value is IncomeCategory {
  return INCOME_BY_ID.has(value);
}

/** True only when the category belongs to the same side of the ledger. */
export function isCategoryFor(value: string, type: EntryType): boolean {
  return type === "income" ? isIncomeCategory(value) : isExpenseCategory(value);
}

/** The catch-all to fall back to when the model picks a mismatched category. */
export function fallbackCategoryFor(type: EntryType): EntryCategory {
  return type === "income" ? "other_income" : "other";
}

export function categoriesFor(type: EntryType): readonly CategoryDefinition[] {
  return type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
}

const FALLBACK_CATEGORY = EXPENSE_BY_ID.get("other") ?? EXPENSE_CATEGORIES[0];

/** Falls back to `other` so an unknown id from the model never breaks the flow. */
export function getCategory(value: string): CategoryDefinition {
  return EXPENSE_BY_ID.get(value) ?? INCOME_BY_ID.get(value) ?? FALLBACK_CATEGORY;
}
