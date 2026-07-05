import { describe, expect, test } from "bun:test";
import { isOnboardingComplete, type OnboardingProfileFields } from "@/lib/onboarding/helpers";

/**
 * lib/onboarding/helpers — the first-login gate's pure completeness check
 * (app/(app)/layout.tsx redirects an employee to /onboarding while this is
 * false). PAN is deliberately excluded — see the helper's doc comment.
 */

const COMPLETE: OnboardingProfileFields = {
  birth_date: "1995-04-12",
  date_of_joining: "2024-01-15",
  bank_account_name: "Ravi Kumar",
  bank_account_number: "123456789012",
  bank_ifsc: "HDFC0001234",
  bank_name: "HDFC Bank",
};

describe("isOnboardingComplete", () => {
  test("true when every required field is present", () => {
    expect(isOnboardingComplete(COMPLETE)).toBe(true);
  });

  test("false when birth_date is null", () => {
    expect(isOnboardingComplete({ ...COMPLETE, birth_date: null })).toBe(false);
  });

  test("false when date_of_joining is null", () => {
    expect(isOnboardingComplete({ ...COMPLETE, date_of_joining: null })).toBe(false);
  });

  test("false when any bank field is null", () => {
    expect(isOnboardingComplete({ ...COMPLETE, bank_ifsc: null })).toBe(false);
    expect(isOnboardingComplete({ ...COMPLETE, bank_account_number: null })).toBe(false);
    expect(isOnboardingComplete({ ...COMPLETE, bank_account_name: null })).toBe(false);
    expect(isOnboardingComplete({ ...COMPLETE, bank_name: null })).toBe(false);
  });

  test("false when a bank field is present but blank/whitespace", () => {
    expect(isOnboardingComplete({ ...COMPLETE, bank_name: "   " })).toBe(false);
  });

  test("a brand-new profile (everything null) is not complete", () => {
    const empty: OnboardingProfileFields = {
      birth_date: null,
      date_of_joining: null,
      bank_account_name: null,
      bank_account_number: null,
      bank_ifsc: null,
      bank_name: null,
    };
    expect(isOnboardingComplete(empty)).toBe(false);
  });
});
