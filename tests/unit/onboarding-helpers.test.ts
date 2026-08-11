import { describe, expect, test } from "bun:test";
import {
  isOnboardingComplete,
  validateOnboardingInput,
  type OnboardingProfileFields,
} from "@/lib/onboarding/helpers";

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

/**
 * The submitted-form validator.
 *
 * These exist because of a live failure on 2026-08-11: the Server Action called
 * `.parse()`, so one mistyped IFSC threw a ZodError, which Next surfaced as a
 * full-screen "Something went wrong" on the first page a new employee ever
 * sees. What matters here is not that bad input is rejected — zod does that —
 * but that rejection ARRIVES AS A VALUE. Nothing in this file may ever throw.
 */
const VALID_SUBMISSION = {
  birth_date: "1995-04-12",
  date_of_joining: "2024-01-15",
  bank_account_name: "Ravi Kumar",
  bank_account_number: "123456789012",
  bank_ifsc: "HDFC0001234",
  bank_name: "HDFC Bank",
};

describe("validateOnboardingInput", () => {
  test("accepts a well-formed submission", () => {
    const result = validateOnboardingInput(VALID_SUBMISSION);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.bank_ifsc).toBe("HDFC0001234");
  });

  test("a bad IFSC comes back as a message, not an exception", () => {
    const result = validateOnboardingInput({ ...VALID_SUBMISSION, bank_ifsc: "HDFC001234" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("IFSC");
  });

  test("an account number with punctuation is rejected without throwing", () => {
    // Passes the form's own "is it blank" check, so this is the shape that
    // actually reached the server and killed the screen.
    const result = validateOnboardingInput({ ...VALID_SUBMISSION, bank_account_number: "1234-5678-9012" });
    expect(result.ok).toBe(false);
  });

  test("never throws, whatever it is handed", () => {
    const garbage: unknown[] = [null, undefined, 42, "text", {}, { bank_ifsc: 12345 }, []];
    for (const input of garbage) {
      expect(() => validateOnboardingInput(input)).not.toThrow();
      expect(validateOnboardingInput(input).ok).toBe(false);
    }
  });

  test("always carries a non-empty message when it rejects", () => {
    const result = validateOnboardingInput({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.trim().length).toBeGreaterThan(0);
  });

  test("lowercase IFSC is accepted and upper-cased, not rejected", () => {
    const result = validateOnboardingInput({ ...VALID_SUBMISSION, bank_ifsc: "hdfc0001234" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.bank_ifsc).toBe("HDFC0001234");
  });
});
