// Croatian Profit Tax Act (Zakon o porezu na dobit) deduction-ceiling
// helpers. The statutory ceiling on deductible public-benefit donations is
// expressed as a percent of the prior fiscal year's revenue. The live value
// is read from DEDUCTION_CEILING_PCT so the 2% → 4% transition can ship as
// a config flip instead of a code change.

const DEFAULT_CEILING_PCT = 2.0;

export function ceilingPct(): number {
  const raw = process.env.DEDUCTION_CEILING_PCT;
  if (!raw) return DEFAULT_CEILING_PCT;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_CEILING_PCT;
  return Math.min(100, Math.max(0, parsed));
}

export function headroomEur(priorYearRevenueEur: number | null | undefined): number {
  if (!priorYearRevenueEur || priorYearRevenueEur <= 0) return 0;
  return (priorYearRevenueEur * ceilingPct()) / 100;
}

export function consumedPct(
  totalGivenEur: number,
  priorYearRevenueEur: number | null | undefined
): number {
  const ceiling = headroomEur(priorYearRevenueEur);
  if (ceiling <= 0) return 0;
  return (totalGivenEur / ceiling) * 100;
}

export function remainingHeadroomEur(
  totalGivenEur: number,
  priorYearRevenueEur: number | null | undefined
): number {
  return Math.max(0, headroomEur(priorYearRevenueEur) - totalGivenEur);
}

export function isWithinCeiling(
  totalGivenEur: number,
  priorYearRevenueEur: number | null | undefined
): boolean {
  return totalGivenEur <= headroomEur(priorYearRevenueEur);
}
