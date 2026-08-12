/**
 * Client-side password quality rules for the sign-up and password-change
 * surfaces.
 *
 * Scope, so nobody mistakes this for authentication work: the application never
 * sees, transports or stores a password hash. Supabase Auth (GoTrue) hashes
 * with bcrypt on its side. Nothing here changes how a password is stored, and
 * nothing here may ever be used to gate a *sign-in* — an existing user must
 * keep signing in with the password they already have, however short it is.
 * These rules apply to choosing a new password only.
 *
 * The scoring is a deliberately modest entropy estimate: pool size implied by
 * the character classes present, multiplied by the length that survives after
 * removing repeated runs, sequential runs and known-guessable tokens. It is
 * honest about what it measures and it does not pretend to be a dictionary
 * attack simulator — a passphrase built from common words still scores well
 * here. The real backstop for "this exact password is in a breach corpus" is
 * Supabase's Leaked Password Protection (HaveIBeenPwned), which is a project
 * setting rather than client code; see the release checklist.
 *
 * Only `rejectionKey` may block a submission. The score is advisory.
 */

/** The password is shorter than the surface's configured minimum. */
export const PASSWORD_TOO_SHORT = "auth.password_too_short";
/** The password is dominated by the site name or a well-known guess. */
export const PASSWORD_TOO_COMMON = "auth.password_common";
/** The password is built out of the user's own email or name. */
export const PASSWORD_TOO_PERSONAL = "auth.password_personal";
/** Runs (`aaaa`, `abcd`, `4321`) eat so much of it that little choice is left. */
export const PASSWORD_TOO_PATTERNED = "auth.password_pattern";

/** Number of segments the meter draws; also the top score. */
export const PASSWORD_STRENGTH_LEVELS = 4;

export type PasswordScore = 1 | 2 | 3 | 4;

export type PasswordContext = {
  /**
   * Hard minimum, owned by the auth surfaces (`MIN_PASSWORD_LENGTH`) rather
   * than by this module, so the number stays defined in exactly one place.
   */
  minLength: number;
  /** Email typed into the form, when the surface collects one. */
  email?: string;
  /** Full name typed into the form, when the surface collects one. */
  name?: string;
};

export type PasswordStrength = {
  /** 1 = weak … 4 = strong. Advisory: never blocks a submission. */
  score: PasswordScore;
  /** Translation key for the band word, shown next to the coloured bar. */
  labelKey: string;
  /** Translation key for the single most useful improvement, if any. */
  hintKey: string | null;
  /** Translation key for a hard-rule failure, or null when submittable. */
  rejectionKey: string | null;
};

const SCORE_LABELS: Record<PasswordScore, string> = {
  1: "auth.password_strength_weak",
  2: "auth.password_strength_fair",
  3: "auth.password_strength_good",
  4: "auth.password_strength_strong",
};

const HINT_LENGTH = "auth.password_hint_length";
const HINT_VARIETY = "auth.password_hint_variety";
const HINT_PATTERN = "auth.password_hint_pattern";

/**
 * The site's own name is the single most guessable token on this form, so it
 * is rejected wherever it appears rather than only when it dominates.
 */
const SITE_TOKENS = ["dajsrce"];

/**
 * Small, curated list — the point is to catch the handful of passwords a
 * bored attacker tries first, in both languages the product ships in. Anything
 * larger belongs in the breach-corpus check on the provider side.
 */
const COMMON_TOKENS = [
  "password",
  "passwort",
  "lozinka",
  "zaporka",
  "qwerty",
  "qwertz",
  "asdfgh",
  "zxcvbn",
  "123456",
  "abc123",
  "letmein",
  "welcome",
  "admin",
  "iloveyou",
  "monkey",
  "sunshine",
  "hrvatska",
  "zagreb",
];

/** `đ` has no canonical decomposition, so NFD alone will not fold it. */
const EXTRA_FOLD: Record<string, string> = {
  đ: "d",
  ð: "d",
  ø: "o",
  ł: "l",
};

/** Single-character leet substitutions, so `P4ssw0rd` folds onto `password`. */
const LEET_FOLD: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
  "@": "a",
  "$": "s",
  "!": "i",
};

/**
 * Normalizes for token matching: strips diacritics, lowercases and folds leet
 * substitutions. Every mapping is one character to one character, so the
 * folded length still matches the typed length and the "does this token
 * dominate the password" ratios stay meaningful.
 */
function fold(value: string): string {
  // NFD splits `č` into `c` + a combining mark; `\p{M}` then drops the mark.
  const bare = value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  let out = "";
  for (const char of bare) {
    out += LEET_FOLD[char] ?? EXTRA_FOLD[char] ?? char;
  }
  return out;
}

const FOLDED_SITE_TOKENS = SITE_TOKENS.map(fold);
const FOLDED_COMMON_TOKENS = COMMON_TOKENS.map(fold);

/**
 * Every way a token can be read out of one identity string: the whole thing,
 * its alphanumeric pieces, and its letters-only pieces — so `ivan.drazetic2`
 * also yields `drazetic`, which is what people actually reuse.
 */
function expandToken(value: string): string[] {
  return [
    value,
    ...value.split(/[^\p{L}\p{N}]+/u),
    ...value.split(/[^\p{L}]+/u),
  ];
}

/** Tokens derived from what the user has already typed about themselves. */
function identityTokens(context: PasswordContext): string[] {
  const parts: string[] = [];

  const email = context.email?.trim() ?? "";
  if (email) {
    const at = email.indexOf("@");
    // The domain is shared by every colleague, so only the local part counts.
    parts.push(...expandToken(at > 0 ? email.slice(0, at) : email));
  }

  const name = context.name?.trim() ?? "";
  if (name) parts.push(...expandToken(name));

  const folded = parts.map(fold).filter((token) => token.length >= 3);
  return [...new Set(folded)];
}

/**
 * True when removing the token leaves nothing worth attacking — either it is
 * at least half the password, or the remainder is a stub like `123`.
 */
function dominates(folded: string, token: string): boolean {
  if (!token || !folded.includes(token)) return false;
  if (token.length * 2 >= folded.length) return true;
  return folded.split(token).join("").length < 4;
}

/** Identity tokens are rejected on sight once they are long enough to matter. */
function leaksIdentity(folded: string, token: string): boolean {
  if (token.length >= 4) return folded.includes(token);
  return dominates(folded, token);
}

/**
 * Characters that carry no real choice: the 3rd and later character of a
 * repeated run (`aaa`) or of an ascending/descending alphanumeric run
 * (`abc`, `987`).
 */
function patternPenalty(password: string): number {
  const value = password.toLowerCase();
  let penalty = 0;
  let repeatRun = 1;
  let sequenceRun = 1;
  let sequenceStep = 0;

  for (let i = 1; i < value.length; i += 1) {
    const previous = value.charCodeAt(i - 1);
    const current = value.charCodeAt(i);

    if (current === previous) {
      repeatRun += 1;
      if (repeatRun >= 3) penalty += 1;
    } else {
      repeatRun = 1;
    }

    const step = current - previous;
    const alphanumericPair =
      /[a-z0-9]/.test(value[i]) && /[a-z0-9]/.test(value[i - 1]);

    if (alphanumericPair && (step === 1 || step === -1)) {
      if (sequenceRun > 1 && step === sequenceStep) {
        sequenceRun += 1;
        if (sequenceRun >= 3) penalty += 1;
      } else {
        sequenceRun = 2;
        sequenceStep = step;
      }
    } else {
      sequenceRun = 1;
      sequenceStep = 0;
    }
  }

  return penalty;
}

const CLASSES: ReadonlyArray<readonly [RegExp, number]> = [
  [/[a-z]/, 26],
  [/[A-Z]/, 26],
  [/[0-9]/, 10],
  [/[^a-zA-Z0-9]/, 33],
];

function poolSize(password: string): { pool: number; classes: number } {
  let pool = 0;
  let classes = 0;
  for (const [pattern, size] of CLASSES) {
    if (pattern.test(password)) {
      pool += size;
      classes += 1;
    }
  }
  return { pool: Math.max(pool, 2), classes };
}

/** Length of the longest guessable token present, which contributes no choice. */
function guessableOverlap(folded: string, context: PasswordContext): number {
  let longest = 0;
  const tokens = [
    ...FOLDED_SITE_TOKENS,
    ...FOLDED_COMMON_TOKENS,
    ...identityTokens(context),
  ];
  for (const token of tokens) {
    if (folded.includes(token) && token.length > longest) longest = token.length;
  }
  return longest;
}

/**
 * The only function allowed to block a submission. Returns a translation key
 * or null. Order is by how actionable the message is.
 */
export function passwordRejectionKey(
  password: string,
  context: PasswordContext
): string | null {
  if (password.length < context.minLength) return PASSWORD_TOO_SHORT;

  const folded = fold(password);

  for (const token of identityTokens(context)) {
    if (leaksIdentity(folded, token)) return PASSWORD_TOO_PERSONAL;
  }
  for (const token of FOLDED_SITE_TOKENS) {
    if (folded.includes(token)) return PASSWORD_TOO_COMMON;
  }
  for (const token of FOLDED_COMMON_TOKENS) {
    if (dominates(folded, token)) return PASSWORD_TOO_COMMON;
  }

  // `aaaaaaaaaaaa` clears the length rule while carrying two characters of
  // real choice, so measure the length that survives the runs as well.
  if (password.length - patternPenalty(password) < context.minLength) {
    return PASSWORD_TOO_PATTERNED;
  }
  return null;
}

function scoreFromBits(bits: number): PasswordScore {
  if (bits < 45) return 1;
  if (bits < 60) return 2;
  if (bits < 80) return 3;
  return 4;
}

/**
 * Advisory score plus the hard-rule verdict. Callers show the score, and block
 * only on `rejectionKey`.
 */
export function evaluatePassword(
  password: string,
  context: PasswordContext
): PasswordStrength {
  const rejectionKey = passwordRejectionKey(password, context);
  const folded = fold(password);
  const { pool, classes } = poolSize(password);
  const penalty = patternPenalty(password);
  const overlap = guessableOverlap(folded, context);
  const effectiveLength = Math.max(
    0,
    password.length - penalty - overlap
  );
  const bits = effectiveLength * Math.log2(pool);

  // A password that cannot be submitted must never read as a good one.
  const score: PasswordScore = rejectionKey ? 1 : scoreFromBits(bits);

  let hintKey: string | null = null;
  if (!rejectionKey && score < PASSWORD_STRENGTH_LEVELS) {
    if (penalty > 0) hintKey = HINT_PATTERN;
    else if (classes < 3) hintKey = HINT_VARIETY;
    else hintKey = HINT_LENGTH;
  }

  return {
    score,
    labelKey: SCORE_LABELS[score],
    hintKey,
    rejectionKey,
  };
}
