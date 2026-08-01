import { describe, expect, it } from "vitest";
import { isValidOib } from "./oib.mjs";

describe("Croatian OIB validation", () => {
  it.each(["12345678903", "69435151530"])("accepts valid MOD 11,10 values: %s", (oib) => {
    expect(isValidOib(oib)).toBe(true);
  });

  it.each(["12345678901", "69435151531", "123", "ABCDEFGHIJK", "1234567890 "])(
    "rejects malformed or checksum-invalid values: %s",
    (oib) => {
      expect(isValidOib(oib)).toBe(false);
    }
  );
});
