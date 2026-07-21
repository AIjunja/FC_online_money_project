export type Member = { id: string; name: string; role: "OWNER" | "MEMBER" };
export type Loss = { id: string; loser_id: string; amount: number; played_at: string; memo: string; loser_name: string };
export type Settlement = { id: string | null; debtorId: string | null; creditorId: string | null; baseAmount: number; multiplier: 1 | 2; finalAmount: number; penaltyAt: string; status: "OPEN" | "PAID"; paid_at: string | null };
export type Dashboard = { room: { code: string; name: string }; currentMember: Member; month: string; members: Member[]; losses: Loss[]; totals: Record<string, number>; settlement: Settlement; auditLogs: Array<Record<string, unknown>> };
