export type SettlementStatus = "OPEN" | "PAID";

export type SettlementInput = {
  month: string;
  totals: Record<string, number>;
  settlementStatus: SettlementStatus;
  settledFinalAmount?: number;
  now?: Date;
};

export type SettlementResult = {
  debtorId: string | null;
  creditorId: string | null;
  baseAmount: number;
  multiplier: 1 | 2;
  finalAmount: number;
  penaltyAt: string;
};

const kstDate = (date: Date): Date => new Date(date.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));

export function getPenaltyAt(month: string): Date {
  const [year, monthNumber] = month.split("-").map(Number);
  // The base amount is available through the first day of the following month.
  return new Date(Date.UTC(year, monthNumber, 1, 15, 0, 0));
}

export function calculateSettlement(input: SettlementInput): SettlementResult {
  const entries = Object.entries(input.totals).sort((a, b) => b[1] - a[1]);
  const [top, bottom] = entries;
  const baseAmount = top && bottom ? Math.abs(top[1] - bottom[1]) : 0;
  const now = input.now ?? new Date();
  const isLate = kstDate(now).getTime() >= kstDate(getPenaltyAt(input.month)).getTime();
  const multiplier: 1 | 2 = input.settlementStatus === "PAID" ? 1 : isLate ? 2 : 1;
  return {
    debtorId: baseAmount > 0 && top ? top[0] : null,
    creditorId: baseAmount > 0 && bottom ? bottom[0] : null,
    baseAmount,
    multiplier,
    finalAmount: input.settlementStatus === "PAID" ? input.settledFinalAmount ?? baseAmount : baseAmount * multiplier,
    penaltyAt: getPenaltyAt(input.month).toISOString(),
  };
}

export function monthOf(date: string): string { return date.slice(0, 7); }
