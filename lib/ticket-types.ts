/**
 * Ticket vocabulary, safe for the browser.
 *
 * No imports, on purpose — the dialogs and the thread are client components, and importing
 * these from lib/tickets.ts would drag the Postgres driver into the browser bundle. That has
 * bitten this codebase twice; see lib/announcement-types.ts and lib/auth/constants.ts.
 */

export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const CATEGORIES = ["general", "billing", "plex", "account"] as const;
export type Category = (typeof CATEGORIES)[number];

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

/** How each priority reads. Normal is deliberately unstyled: it is the default, not news. */
export const PRIORITY_TONE: Record<Priority, string> = {
  low: "text-muted-foreground",
  normal: "text-foreground",
  high: "text-warning",
  urgent: "text-destructive",
};

export const CATEGORY_LABEL: Record<Category, string> = {
  general: "General",
  billing: "Billing",
  plex: "Plex",
  account: "Account",
};

/** What the member is told each category is for, so the choice is not a guess. */
export const CATEGORY_HINT: Record<Category, string> = {
  general: "Anything else",
  billing: "Payments, plans, refunds",
  plex: "Watching, invites, libraries",
  account: "Sign in, email, password",
};

export const isPriority = (value: unknown): value is Priority =>
  typeof value === "string" && (PRIORITIES as readonly string[]).includes(value);

export const isCategory = (value: unknown): value is Category =>
  typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);

export const priorityLabel = (value: string) =>
  isPriority(value) ? PRIORITY_LABEL[value] : value;

export const categoryLabel = (value: string) =>
  isCategory(value) ? CATEGORY_LABEL[value] : value;

export const priorityTone = (value: string) =>
  isPriority(value) ? PRIORITY_TONE[value] : "text-foreground";
