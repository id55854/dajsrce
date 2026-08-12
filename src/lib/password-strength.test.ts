import { describe, expect, it } from "vitest";
import {
  PASSWORD_STRENGTH_LEVELS,
  PASSWORD_TOO_COMMON,
  PASSWORD_TOO_PATTERNED,
  PASSWORD_TOO_PERSONAL,
  PASSWORD_TOO_SHORT,
  evaluatePassword,
  passwordRejectionKey,
} from "./password-strength";

/** Mirrors `MIN_PASSWORD_LENGTH`; the module itself owns no minimum. */
const MIN = 12;
const base = { minLength: MIN };

describe("passwordRejectionKey", () => {
  it("rejects anything below the surface minimum", () => {
    expect(passwordRejectionKey("Ab1!xyzQ", base)).toBe(PASSWORD_TOO_SHORT);
    expect(passwordRejectionKey("", base)).toBe(PASSWORD_TOO_SHORT);
    // Exactly at the minimum is long enough.
    expect(passwordRejectionKey("Vjetar-Nosi7", base)).toBeNull();
  });

  it("rejects the site name wherever it appears", () => {
    expect(passwordRejectionKey("dajsrce-2026-ok", base)).toBe(
      PASSWORD_TOO_COMMON
    );
    expect(passwordRejectionKey("vjetar-DajSrce-plavi", base)).toBe(
      PASSWORD_TOO_COMMON
    );
  });

  it("rejects well-known guesses, including leet spellings", () => {
    expect(passwordRejectionKey("Password1234", base)).toBe(PASSWORD_TOO_COMMON);
    expect(passwordRejectionKey("P4ssw0rd-2026", base)).toBe(PASSWORD_TOO_COMMON);
    expect(passwordRejectionKey("lozinka123456", base)).toBe(PASSWORD_TOO_COMMON);
    expect(passwordRejectionKey("Lozinka!2026", base)).toBe(PASSWORD_TOO_COMMON);
  });

  it("does not reject a long passphrase that merely contains a listed word", () => {
    // `admin` is on the list, but it is a fifth of this password, not its whole
    // substance — the rule is dominance, not naive substring matching.
    expect(
      passwordRejectionKey("administrativni-zahtjev-9", base)
    ).toBeNull();
  });

  it("rejects the user's own email local part", () => {
    const context = { ...base, email: "ivan.drazetic2@intercapital.hr" };
    expect(passwordRejectionKey("IvanDrazetic2026!", context)).toBe(
      PASSWORD_TOO_PERSONAL
    );
    expect(passwordRejectionKey("drazetic-plavi-9", context)).toBe(
      PASSWORD_TOO_PERSONAL
    );
    // The domain is not the user's secret and must not trigger the rule.
    expect(passwordRejectionKey("vjetar-nosi-plavi-9", context)).toBeNull();
  });

  it("rejects the user's own name, diacritics folded", () => {
    const context = { ...base, name: "Ivana Horvatić" };
    expect(passwordRejectionKey("IvanaHorvatic26", context)).toBe(
      PASSWORD_TOO_PERSONAL
    );
    expect(passwordRejectionKey("horvatic-plavi9", context)).toBe(
      PASSWORD_TOO_PERSONAL
    );
  });

  it("rejects long strings made of repeats or sequential runs", () => {
    expect(passwordRejectionKey("aaaaaaaaaaaaaa", base)).toBe(
      PASSWORD_TOO_PATTERNED
    );
    expect(passwordRejectionKey("abcdefghijklmn", base)).toBe(
      PASSWORD_TOO_PATTERNED
    );
    expect(passwordRejectionKey("987654321012", base)).toBe(
      PASSWORD_TOO_PATTERNED
    );
  });

  it("accepts a strong passphrase", () => {
    expect(
      passwordRejectionKey("vjetar-nosi-plavi-kisobran", base)
    ).toBeNull();
    expect(passwordRejectionKey("Sunčan Dan U Rijeci 26", base)).toBeNull();
  });
});

describe("evaluatePassword", () => {
  it("scores a strong passphrase at the top band with no nagging hint", () => {
    const result = evaluatePassword("vjetar-nosi-plavi-kisobran", base);
    expect(result.rejectionKey).toBeNull();
    expect(result.score).toBe(PASSWORD_STRENGTH_LEVELS);
    expect(result.labelKey).toBe("auth.password_strength_strong");
    expect(result.hintKey).toBeNull();
  });

  it("never presents a rejected password as anything but weak", () => {
    // Random-looking but too short: the hard rule still governs the meter.
    const result = evaluatePassword("Xk9#mQ2!", base);
    expect(result.rejectionKey).toBe(PASSWORD_TOO_SHORT);
    expect(result.score).toBe(1);
    expect(result.labelKey).toBe("auth.password_strength_weak");
    // The inline error carries the message; the meter does not repeat it.
    expect(result.hintKey).toBeNull();
  });

  it("discounts the characters spent on runs rather than counting length alone", () => {
    const patterned = evaluatePassword("abcdefghijklmnop", base);
    const varied = evaluatePassword("mkbtwqzrjxvfhdps", base);
    expect(patterned.score).toBeLessThan(varied.score);
  });

  it("points at the single most useful improvement", () => {
    // One class, no runs: variety is the gap.
    expect(evaluatePassword("mkbtwqzrjxvf", base).hintKey).toBe(
      "auth.password_hint_variety"
    );
    // Three classes present and no runs, but still short of the top band.
    expect(evaluatePassword("Mkb7wqZr", { ...base, minLength: 8 }).hintKey).toBe(
      "auth.password_hint_length"
    );
  });

  it("is monotonic in length for a fixed alphabet", () => {
    // Cycling these four characters keeps the class mix constant and produces
    // no repeated or sequential run, so length is the only variable.
    const alphabet = "aM7#";
    let previous = 0;
    for (let length = 1; length <= 40; length += 1) {
      const password = Array.from(
        { length },
        (_, index) => alphabet[index % alphabet.length]
      ).join("");
      const { score } = evaluatePassword(password, base);
      expect(
        score,
        `score dropped at length ${length} ("${password}")`
      ).toBeGreaterThanOrEqual(previous);
      previous = score;
    }
    expect(previous).toBe(PASSWORD_STRENGTH_LEVELS);
  });
});
