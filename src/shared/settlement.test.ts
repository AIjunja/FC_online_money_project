import { describe, expect, it } from "vitest";
import { calculateSettlement } from "./settlement";

describe("calculateSettlement", () => {
  it("calculates the difference and payer", () => {
    const result = calculateSettlement({ month: "2026-07", totals: { a: 7000, b: 4000 }, settlementStatus: "OPEN", now: new Date("2026-07-20T00:00:00Z") });
    expect(result).toMatchObject({ debtorId: "a", creditorId: "b", baseAmount: 3000, finalAmount: 3000, multiplier: 1 });
  });
  it("applies exactly one late multiplier after Aug 2 KST", () => {
    const result = calculateSettlement({ month: "2026-07", totals: { a: 7000, b: 4000 }, settlementStatus: "OPEN", now: new Date("2026-08-01T15:00:00Z") });
    expect(result.finalAmount).toBe(6000);
    expect(result.multiplier).toBe(2);
  });
  it("does not change a paid snapshot", () => {
    const result = calculateSettlement({ month: "2026-07", totals: { a: 7000, b: 4000 }, settlementStatus: "PAID", settledFinalAmount: 3000, now: new Date("2026-09-01T00:00:00Z") });
    expect(result.finalAmount).toBe(3000);
    expect(result.multiplier).toBe(1);
  });
});
