/**
 * Seed list of expense categories.
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
    hint: "Bank fees, interest, taxes, fines, transfers",
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
    hint: "Anything that does not fit the categories above",
  },
] as const satisfies readonly ExpenseCategoryDefinition[];

export type ExpenseCategoryDefinition = {
  id: string;
  label: string;
  emoji: string;
  hint: string;
};

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]["id"];

export const EXPENSE_CATEGORY_IDS: readonly ExpenseCategory[] =
  EXPENSE_CATEGORIES.map((category) => category.id);

const CATEGORY_BY_ID = new Map<string, ExpenseCategoryDefinition>(
  EXPENSE_CATEGORIES.map((category) => [category.id, category]),
);

export function isExpenseCategory(value: string): value is ExpenseCategory {
  return CATEGORY_BY_ID.has(value);
}

const FALLBACK_CATEGORY = CATEGORY_BY_ID.get("other") ?? EXPENSE_CATEGORIES[0];

/** Falls back to `other` so an unknown id from the model never breaks the flow. */
export function getExpenseCategory(value: string): ExpenseCategoryDefinition {
  return CATEGORY_BY_ID.get(value) ?? FALLBACK_CATEGORY;
}
