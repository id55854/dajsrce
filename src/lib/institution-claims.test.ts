import { describe, expect, it } from "vitest";
import {
  CLAIM_EMAIL_TOKEN_BYTES,
  CLAIM_NOTE_MAX_LENGTH,
  claimErrorStatus,
  isClaimTokenDigest,
  isInstitutionClaimStatus,
  isOpenInstitutionClaim,
  isRawClaimToken,
  parseClaimRequestInput,
  parseClaimReviewInput,
  parseClaimSearchInput,
} from "@/lib/institution-claims";

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
