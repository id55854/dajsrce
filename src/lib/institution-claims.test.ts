import { describe, expect, it } from "vitest";
import {
  CLAIM_EMAIL_TOKEN_BYTES,
  CLAIM_NOTE_MAX_LENGTH,
  CLAIM_OUT_OF_BAND_NOTE_MAX_LENGTH,
  claimApprovalNote,
  claimChallengeState,
  claimConfirmationOutcome,
  claimErrorCode,
  claimErrorMessageKey,
  claimErrorStatus,
  claimReviewErrorMessageKey,
  claimSearchErrorMessageKey,
  isClaimTokenDigest,
  isInstitutionClaimStatus,
  isOpenInstitutionClaim,
  isRawClaimToken,
  maskEmailAddress,
  parseClaimRequestInput,
  parseClaimReviewInput,
  parseClaimSearchInput,
  sameEmailAddress,
  takeClaimToken,
} from "@/lib/institution-claims";
import { dictionaries, resolveKey } from "@/i18n/dictionaries";

describe("parseClaimRequestInput", () => {
  const valid = {
    udr_id: "200307",
    contact_email: "Ured@Udruga.hr",
    evidence_note: "  Predsjednica udruge.  ",
  };

  it("normalises the register id, email casing and note", () => {
    const parsed = parseClaimRequestInput(valid);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.udrId).toBe("200307");
    expect(parsed.value.contactEmail).toBe("ured@udruga.hr");
    expect(parsed.value.evidenceNote).toBe("Predsjednica udruge.");
  });

  it("treats an empty note as absent rather than as an empty string", () => {
    const parsed = parseClaimRequestInput({ ...valid, evidence_note: "   " });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.evidenceNote).toBeNull();
  });

  it("rejects a missing or malformed register id", () => {
    expect(parseClaimRequestInput({ ...valid, udr_id: undefined }).ok).toBe(false);
    expect(parseClaimRequestInput({ ...valid, udr_id: "   " }).ok).toBe(false);
    expect(parseClaimRequestInput({ ...valid, udr_id: "x".repeat(65) }).ok).toBe(false);
  });

  it("rejects an email that is not an email", () => {
    for (const contact_email of ["", "nope", "a@b", "a b@c.hr", `${"a".repeat(250)}@b.hr`]) {
      expect(parseClaimRequestInput({ ...valid, contact_email }).ok, contact_email).toBe(false);
    }
  });

  it("bounds the evidence note", () => {
    const parsed = parseClaimRequestInput({
      ...valid,
      evidence_note: "a".repeat(CLAIM_NOTE_MAX_LENGTH + 1),
    });
    expect(parsed.ok).toBe(false);
  });

  it("refuses a body that is not an object", () => {
    expect(parseClaimRequestInput(null).ok).toBe(false);
    expect(parseClaimRequestInput([valid]).ok).toBe(false);
    expect(parseClaimRequestInput("udr_id=1").ok).toBe(false);
  });
});

describe("parseClaimReviewInput", () => {
  it("accepts an approval with no note", () => {
    const parsed = parseClaimReviewInput({ decision: "approve" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual({ decision: "approve", note: null });
  });

  it("requires a reason on rejection so the applicant can act on it", () => {
    expect(parseClaimReviewInput({ decision: "reject" }).ok).toBe(false);
    expect(parseClaimReviewInput({ decision: "reject", note: "   " }).ok).toBe(false);
    expect(parseClaimReviewInput({ decision: "reject", note: "Nije dokazano." }).ok).toBe(true);
  });

  it("only knows two decisions", () => {
    for (const decision of ["approved", "delete", "", null, 1]) {
      expect(parseClaimReviewInput({ decision }).ok).toBe(false);
    }
  });
});

describe("parseClaimSearchInput", () => {
  it("requires a bounded query and caps the page", () => {
    const ok = parseClaimSearchInput(new URLSearchParams("q=udruga&limit=25"));
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.value).toEqual({ query: "udruga", county: null, limit: 25 });
  });

  it("refuses an unbounded or missing query", () => {
    expect(parseClaimSearchInput(new URLSearchParams("")).ok).toBe(false);
    expect(parseClaimSearchInput(new URLSearchParams("q=u")).ok).toBe(false);
    expect(parseClaimSearchInput(new URLSearchParams(`q=${"u".repeat(101)}`)).ok).toBe(false);
  });

  it("refuses a limit above the cap", () => {
    expect(parseClaimSearchInput(new URLSearchParams("q=udruga&limit=26")).ok).toBe(false);
    expect(parseClaimSearchInput(new URLSearchParams("q=udruga&limit=abc")).ok).toBe(false);
  });
});

describe("token shapes", () => {
  it("recognises a SHA-256 digest and nothing else", () => {
    expect(isClaimTokenDigest("a".repeat(64))).toBe(true);
    expect(isClaimTokenDigest("A".repeat(64))).toBe(false);
    expect(isClaimTokenDigest("a".repeat(63))).toBe(false);
    expect(isClaimTokenDigest(null)).toBe(false);
  });

  it("recognises the raw token that only ever lives in the email URL", () => {
    expect(isRawClaimToken("f".repeat(CLAIM_EMAIL_TOKEN_BYTES * 2))).toBe(true);
    expect(isRawClaimToken("f".repeat(CLAIM_EMAIL_TOKEN_BYTES * 2 - 1))).toBe(false);
    expect(isRawClaimToken("../../etc/passwd")).toBe(false);
  });
});

describe("status helpers", () => {
  it("knows the five claim states", () => {
    expect(isInstitutionClaimStatus("email_sent")).toBe(true);
    expect(isInstitutionClaimStatus("verified")).toBe(false);
  });

  it("treats only pending and email_sent as open", () => {
    expect(isOpenInstitutionClaim("pending")).toBe(true);
    expect(isOpenInstitutionClaim("email_sent")).toBe(true);
    expect(isOpenInstitutionClaim("approved")).toBe(false);
    expect(isOpenInstitutionClaim("rejected")).toBe(false);
    expect(isOpenInstitutionClaim("withdrawn")).toBe(false);
  });
});

describe("claimErrorStatus", () => {
  it("maps database refusals to stable statuses", () => {
    expect(claimErrorStatus("42501")).toBe(403);
    expect(claimErrorStatus("P0002")).toBe(404);
    expect(claimErrorStatus("22023")).toBe(400);
    expect(claimErrorStatus("P0001")).toBe(409);
    expect(claimErrorStatus("23505")).toBe(409);
    expect(claimErrorStatus(undefined)).toBe(500);
  });
});

describe("claimErrorCode", () => {
  it("names each refusal the claim RPCs raise", () => {
    const cases: Array<[string, string, string]> = [
      ["P0001", "an open claim already exists for this account", "open_claim_exists"],
      ["P0001", "this organisation already has a claim under review", "organisation_claimed"],
      ["P0001", "organisation is already linked on the platform", "organisation_linked"],
      ["P0001", "this account is already linked to an organisation", "account_linked"],
      ["P0001", "organisation is not active in the official register", "organisation_inactive"],
      ["P0002", "organisation is not in the published registry snapshot", "organisation_not_found"],
      ["P0002", "no registry snapshot is published", "registry_unavailable"],
      ["42501", "this account cannot claim an organisation", "account_ineligible"],
      ["P0001", "claim is no longer open", "claim_closed"],
      ["P0002", "claim not found", "claim_not_found"],
      ["42501", "claim does not belong to this account", "claim_not_owned"],
      ["P0001", "the official register publishes no email for this organisation", "no_registry_email"],
      ["P0002", "verification not found", "token_invalid"],
      ["P0001", "verification already used", "token_used"],
      ["P0001", "verification expired", "token_expired"],
      ["42501", "reviewer is not an administrator", "reviewer_not_admin"],
      ["P0001", "applicant is already linked to an organisation", "applicant_linked"],
      ["P0001", "the register has no usable location for this organisation", "no_location"],
      ["P0001", "claim cannot be approved: mailbox not verified", "mailbox_not_verified"],
    ];
    for (const [code, message, expected] of cases) {
      expect(claimErrorCode({ code, message }), message).toBe(expected);
    }
  });

  it("tells the two unique indexes apart and treats an unnamed one as a lost race", () => {
    expect(
      claimErrorCode({
        code: "23505",
        message: 'duplicate key value violates unique constraint "uq_institution_claims_open_per_profile"',
      })
    ).toBe("open_claim_exists");
    expect(
      claimErrorCode({
        code: "23505",
        message: 'duplicate key value violates unique constraint "uq_institution_claims_open_per_udr"',
      })
    ).toBe("organisation_claimed");
    expect(claimErrorCode({ code: "23505" })).toBe("organisation_claimed");
  });

  it("does not invent a reason for anything else", () => {
    expect(claimErrorCode({ code: "P0001", message: "something new" })).toBeNull();
    expect(claimErrorCode({})).toBeNull();
  });
});

describe("claim error messages", () => {
  const hr = dictionaries.hr;

  it("always resolves to a Croatian sentence, never a key or server text", () => {
    const codes = [
      undefined,
      "account_ineligible",
      "account_linked",
      "open_claim_exists",
      "organisation_claimed",
      "organisation_linked",
      "organisation_inactive",
      "organisation_not_found",
      "registry_unavailable",
      "claim_not_found",
      "claim_not_owned",
      "claim_closed",
      "no_registry_email",
      "mailbox_not_verified",
      "applicant_linked",
      "applicant_ineligible",
      "no_location",
      "reviewer_not_admin",
      "unknown",
    ];
    for (const status of [400, 401, 403, 404, 409, 429, 500, 503]) {
      for (const code of codes) {
        for (const key of [
          claimErrorMessageKey(status, code),
          claimReviewErrorMessageKey(status, code),
          claimSearchErrorMessageKey(status),
        ]) {
          expect(resolveKey(hr, key), `${status} ${code} -> ${key}`).not.toBe(key);
        }
      }
    }
  });

  it("prefers the stable code over the status", () => {
    expect(claimErrorMessageKey(409, "organisation_claimed")).toBe("claims.error_organisation_claimed");
    expect(claimErrorMessageKey(409, null)).toBe("claims.error_conflict");
    expect(claimErrorMessageKey(429)).toBe("auth.error_rate_limited");
    expect(claimReviewErrorMessageKey(409, "mailbox_not_verified")).toBe(
      "admin.claims_error_mailbox_not_verified"
    );
    expect(claimSearchErrorMessageKey(429)).toBe("claims.search_error_rate_limited");
    expect(claimSearchErrorMessageKey(500)).toBe("claims.search_error");
  });
});

describe("claimConfirmationOutcome", () => {
  it("separates a spent link from a closed claim and from an outage", () => {
    expect(claimConfirmationOutcome(200)).toBe("confirmed");
    expect(claimConfirmationOutcome(409, "token_used")).toBe("invalid");
    expect(claimConfirmationOutcome(409, "token_expired")).toBe("invalid");
    expect(claimConfirmationOutcome(404, "token_invalid")).toBe("invalid");
    expect(claimConfirmationOutcome(400)).toBe("invalid");
    expect(claimConfirmationOutcome(409, "claim_closed")).toBe("closed");
    expect(claimConfirmationOutcome(429)).toBe("unavailable");
    expect(claimConfirmationOutcome(500)).toBe("unavailable");
  });
});

describe("takeClaimToken", () => {
  const token = "ab".repeat(32);

  it("reads the fragment used by new links and drops it", () => {
    expect(takeClaimToken(`https://dajsrce.hr/auth/setup#claim_token=${token}`)).toEqual({
      token,
      cleaned: "/auth/setup",
    });
  });

  it("still reads the query used by already-sent links and keeps other parameters", () => {
    expect(
      takeClaimToken(`https://dajsrce.hr/auth/setup?role=ngo&claim_token=${token}#x`)
    ).toEqual({ token, cleaned: "/auth/setup?role=ngo" });
  });

  it("leaves an address without a token untouched", () => {
    expect(takeClaimToken("https://dajsrce.hr/auth/setup?role=ngo#top")).toEqual({
      token: null,
      cleaned: "/auth/setup?role=ngo#top",
    });
  });
});

describe("email helpers", () => {
  it("masks all but the first character of the mailbox", () => {
    expect(maskEmailAddress("udruga@gmail.com")).toBe("u***@gmail.com");
    expect(maskEmailAddress("  a@udruga.hr ")).toBe("a***@udruga.hr");
    expect(maskEmailAddress("čudo@udruga.hr")).toBe("č***@udruga.hr");
    expect(maskEmailAddress("@udruga.hr")).toBeNull();
    expect(maskEmailAddress("udruga@")).toBeNull();
    expect(maskEmailAddress(null)).toBeNull();
  });

  it("compares addresses the way the register and applicants write them", () => {
    expect(sameEmailAddress(" Ured@Udruga.hr", "ured@udruga.hr ")).toBe(true);
    expect(sameEmailAddress("ured@udruga.hr", "predsjednik@udruga.hr")).toBe(false);
    expect(sameEmailAddress(null, null)).toBe(false);
  });
});

describe("claimApprovalNote", () => {
  it("keeps an optional note when the register mailbox was confirmed", () => {
    expect(claimApprovalNote(true, "  ")).toBeNull();
    expect(claimApprovalNote(true, " Sve u redu. ")).toBe("Sve u redu.");
  });

  it("records the out-of-band check with the prefix the approval requires", () => {
    expect(claimApprovalNote(false, "telefonom s predsjednicom udruge")).toBe(
      "Provjereno: telefonom s predsjednicom udruge"
    );
    expect(claimApprovalNote(false, "PROVJERENO:  uvidom u zapisnik")).toBe(
      "Provjereno: uvidom u zapisnik"
    );
    expect(claimApprovalNote(false, "   ")).toBeNull();
    expect(claimApprovalNote(false, "Provjereno:")).toBeNull();
  });

  it("leaves room for the prefix inside the note limit", () => {
    const note = claimApprovalNote(false, "a".repeat(CLAIM_OUT_OF_BAND_NOTE_MAX_LENGTH));
    expect(note?.length).toBe(CLAIM_NOTE_MAX_LENGTH);
  });
});

describe("claimChallengeState", () => {
  const now = Date.parse("2026-09-28T10:00:00Z");
  const base = {
    email_verified: false,
    email_challenge_sent: false,
    email_challenge_expires_at: null,
    organisation: { registry_email: "ured@udruga.hr" },
  };

  it("reports each stage of the mailbox challenge", () => {
    expect(claimChallengeState({ ...base, email_verified: true }, now)).toBe("verified");
    expect(
      claimChallengeState(
        { ...base, email_challenge_sent: true, email_challenge_expires_at: "2026-09-29T10:00:00Z" },
        now
      )
    ).toBe("sent");
    expect(
      claimChallengeState(
        { ...base, email_challenge_sent: true, email_challenge_expires_at: "2026-09-27T10:00:00Z" },
        now
      )
    ).toBe("expired");
    expect(claimChallengeState(base, now)).toBe("not_sent");
    expect(claimChallengeState({ ...base, organisation: { registry_email: null } }, now)).toBe(
      "no_registry_email"
    );
  });
});
