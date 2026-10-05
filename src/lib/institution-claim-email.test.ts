import { describe, expect, it } from "vitest";
import {
  buildClaimChallengeEmail,
  claimEmailSender,
  singleLine,
} from "@/lib/institution-claim-email";

const INPUT = {
  locale: "hr" as const,
  organisationName: 'Udruga "Srce & ruka"',
  applicantName: "Ana Anić",
  confirmUrl: "https://dajsrce.hr/auth/setup#claim_token=abc",
  expiresAt: "2026-09-29T10:00:00Z",
};

describe("buildClaimChallengeEmail", () => {
  it("names the register that published the address of an organisation that is not an association", () => {
    const { subject, text } = buildClaimChallengeEmail({
      ...INPUT,
      organisationName: "CARITAS ZAGREBAČKE NADBISKUPIJE",
      emailSource: "rno",
    });
    expect(subject).toBe(
      "Potvrdite zahtjev za upravljanje profilom organizacije: CARITAS ZAGREBAČKE NADBISKUPIJE"
    );
    expect(text).toContain("službeni Registar neprofitnih organizacija Ministarstva financija");
    expect(text).not.toContain("Registar udruga");
    const english = buildClaimChallengeEmail({ ...INPUT, locale: "en", emailSource: "mrosp" });
    expect(english.text).toContain("the official Register of Social Service Providers publishes");
  });

  it("keeps the associations wording by default", () => {
    expect(buildClaimChallengeEmail(INPUT).text).toContain("službeni Registar udruga");
    expect(buildClaimChallengeEmail({ ...INPUT, emailSource: "registar_udruga" }).text).toContain(
      "službeni Registar udruga"
    );
  });

  it("builds the subject from the unescaped name", () => {
    const { subject } = buildClaimChallengeEmail(INPUT);
    expect(subject).toBe('Potvrdite zahtjev za upravljanje udrugom: Udruga "Srce & ruka"');
    expect(subject).not.toContain("&quot;");
    expect(subject).not.toContain("&amp;");
  });

  it("never lets a line break into the subject", () => {
    const { subject } = buildClaimChallengeEmail({
      ...INPUT,
      organisationName: "Udruga\r\nBcc: attacker@example.com",
    });
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject).toContain("Udruga Bcc: attacker@example.com");
  });

  it("escapes names in the HTML part only", () => {
    const { html, text } = buildClaimChallengeEmail({
      ...INPUT,
      applicantName: "<b>Admin</b>",
    });
    expect(html).toContain("Udruga &quot;Srce &amp; ruka&quot;");
    expect(html).toContain("&lt;b&gt;Admin&lt;/b&gt;");
    expect(html).not.toContain("<b>Admin</b>");
    expect(text).toContain('Udruga "Srce & ruka"');
  });

  it("carries the link and the expiry in the plain-text part", () => {
    const { text } = buildClaimChallengeEmail(INPUT);
    expect(text).toContain(INPUT.confirmUrl);
    expect(text).toContain("29. rujna 2026.");
    expect(text).toContain("kontakt@dajsrce.hr");
    expect(text).toContain("ne odobrava zahtjev");
  });

  it("uses a Croatian fallback when the applicant has no name", () => {
    for (const applicantName of [null, "", "  \n "]) {
      const { text } = buildClaimChallengeEmail({ ...INPUT, applicantName });
      expect(text).toContain("Korisnik DajSrca");
    }
  });

  it("caps a very long name in the subject but keeps it whole in the body", () => {
    const long = `Udruga ${"a".repeat(300)}`;
    const { subject, text } = buildClaimChallengeEmail({ ...INPUT, organisationName: long });
    expect(subject.length).toBeLessThan(200);
    expect(subject.endsWith("…")).toBe(true);
    expect(text).toContain(long);
  });
});

describe("claimEmailSender", () => {
  it("needs both the key and a verified sender, with no resend.dev fallback", () => {
    expect(claimEmailSender({})).toBeNull();
    expect(claimEmailSender({ RESEND_API_KEY: "re_test" })).toBeNull();
    expect(claimEmailSender({ RESEND_FROM_EMAIL: "DajSrce <noreply@dajsrce.hr>" })).toBeNull();
    expect(
      claimEmailSender({ RESEND_API_KEY: "re_test", RESEND_FROM_EMAIL: "DajSrce <noreply@dajsrce.hr>" })
    ).toEqual({
      apiKey: "re_test",
      from: "DajSrce <noreply@dajsrce.hr>",
      replyTo: "kontakt@dajsrce.hr",
    });
  });
});

describe("singleLine", () => {
  it("flattens control characters and runs of spaces", () => {
    expect(singleLine("  a\r\n\tb   c \u0007")).toBe("a b c");
  });
});
