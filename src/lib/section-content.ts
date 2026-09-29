/**
 * Section copy: starter checklist items and the one-line "why it matters"
 * shown in an empty section. Data only; behaviour lives in sections.ts.
 */
import type { SectionKey } from "./sections";

export type ChecklistSeed = { key: string; label: string };

/**
 * Starter checklist items per section, aligned with Clark Howard's family
 * financial emergency file checklist (original wording; inspired by, not
 * affiliated). Item keys are stable identifiers: never rename a key, only add.
 */
export const SECTION_CHECKLISTS: Record<SectionKey, readonly ChecklistSeed[]> = {
  S1: [
    { key: "names", label: "Full legal names for everyone in the household" },
    { key: "birthdates", label: "Dates of birth" },
    { key: "ssn-last4", label: "SSN last 4 for each person (optional, never the full number)" },
    { key: "addresses", label: "Home address and any other residences" },
    { key: "dependents", label: "Dependents and pets, and who would care for them" },
  ],
  S2: [
    { key: "family", label: "Spouse or partner, adult children, and close family" },
    { key: "executor-poa", label: "Executor and financial power of attorney" },
    { key: "health-agent", label: "Health care agent or proxy" },
    { key: "attorney", label: "Estate attorney" },
    { key: "advisor-cpa", label: "Financial advisor and CPA or tax preparer" },
    { key: "insurance-agent", label: "Insurance agent" },
    { key: "employer", label: "Employer HR and any business partner" },
    { key: "neighbor", label: "A neighbor or friend who can check on the house" },
  ],
  S3: [
    { key: "checking-savings", label: "Checking and savings accounts" },
    { key: "cds", label: "CDs and money market accounts" },
    { key: "hsa", label: "Health savings accounts (HSAs)" },
    { key: "access", label: "Who else is on each account or can access it" },
    { key: "safe-deposit", label: "Safe deposit box or home safe, and where the key is" },
  ],
  S4: [
    { key: "cards", label: "Credit cards" },
    { key: "mortgage", label: "Mortgage or home equity loans" },
    { key: "loans", label: "Auto, student, and personal loans" },
    { key: "autopay", label: "Which debts are on autopay, and from which account" },
  ],
  S5: [
    { key: "brokerage", label: "Brokerage accounts" },
    { key: "workplace", label: "401(k), 403(b), and other workplace retirement plans" },
    { key: "ira", label: "IRAs" },
    { key: "529", label: "529 college savings plans" },
    { key: "advisor", label: "Financial advisor for these accounts" },
    { key: "beneficiaries", label: "Beneficiary designations are current (they can override a will)" },
  ],
  S6: [
    { key: "life", label: "Life insurance, both employer and private policies" },
    { key: "health", label: "Health insurance" },
    { key: "home", label: "Homeowners or renters insurance" },
    { key: "auto-umbrella", label: "Auto and umbrella insurance" },
    { key: "disability-ltc", label: "Disability and long-term care insurance" },
    { key: "where-kept", label: "Where each policy is kept and who the agent is" },
  ],
  S7: [
    { key: "employers", label: "Employers and where pay is deposited" },
    { key: "social-security", label: "Social Security information" },
    { key: "pensions", label: "Pensions" },
    { key: "other-income", label: "Other income such as rentals, annuities, or a side business" },
  ],
  S8: [
    { key: "housing", label: "Mortgage or rent, HOA fees, and property taxes" },
    { key: "utilities", label: "Utilities, internet, and phone service" },
    { key: "premiums", label: "Insurance premiums" },
    { key: "care-tuition", label: "Tuition or child care" },
    { key: "subscriptions", label: "Subscriptions, memberships, and charitable giving" },
    { key: "how-paid", label: "How each bill is paid, from which account, and when it is due" },
  ],
  S9: [
    { key: "homes", label: "Homes and other real estate" },
    { key: "deeds", label: "Where deeds and mortgage papers are kept" },
    { key: "vehicles", label: "Vehicles and where the titles are" },
    { key: "valuables", label: "Other significant assets, like jewelry or collectibles" },
  ],
  S10: [
    { key: "email", label: "Primary email accounts" },
    { key: "devices", label: "Phone, tablet, and computer, and how a helper gets in" },
    { key: "password-manager", label: "Password manager name and its emergency access plan" },
    { key: "two-factor", label: "Two-factor and account recovery methods (keep the phone line active)" },
    { key: "cloud", label: "Cloud storage, photos, and important files" },
    { key: "social", label: "Social media and digital subscriptions" },
  ],
  S11: [
    { key: "will", label: "Will" },
    { key: "trusts", label: "Trusts, if any" },
    { key: "poa", label: "Durable financial power of attorney" },
    { key: "advance-directive", label: "Advance directive or living will" },
    { key: "vital-records", label: "Birth, marriage, and divorce certificates" },
    { key: "tax-returns", label: "Recent tax returns" },
    { key: "this-file", label: "Where this emergency file is kept, and who knows about it" },
  ],
  S12: [
    { key: "arrangements", label: "Burial or cremation preferences" },
    { key: "organ-donor", label: "Organ donor decision" },
    { key: "first-steps", label: "What to do first, in the first week" },
    { key: "routines", label: "Household routines someone would need to take over" },
  ],
};

/** Why each section matters, shown while it has no entries yet. */
export const SECTION_PURPOSE: Record<SectionKey, string> = {
  S1: "Gives a helper the basics about who lives here and who depends on whom, so nobody has to guess.",
  S2: "The people to call first. In an emergency, knowing who holds which role saves days of searching.",
  S3: "Where the cash is, so bills keep getting paid while things are sorted out.",
  S4: "What is owed and when it is due, so nothing lapses into late fees or collections.",
  S5: "Retirement and investment accounts are easy to lose track of and slow to claim without a map.",
  S6: "Policies only pay out if someone knows they exist and who to call to file a claim.",
  S7: "Paychecks, pensions, and benefits may need to be reported, redirected, or stopped.",
  S8: "Recurring bills and subscriptions keep running, and charging, until someone cancels them.",
  S9: "Homes and vehicles come with keys, titles, and upkeep that someone will need to take over.",
  S10: "Tells a helper how to get into email, phones, and cloud accounts without you writing down a single password.",
  S11: "Originals are what count. Knowing where the will, deeds, and IDs are kept avoids a frantic search.",
  S12: "Your wishes and the small practical things only you know, in your own words.",
};

/** Standing note on S10, above its checklist. */
export const ACCESS_PLAN_NOTE =
  "Keep the passwords themselves in a password manager. Here, write which one you use, who has emergency access, and where the recovery kit or backup codes are kept.";
