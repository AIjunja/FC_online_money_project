import type { Dashboard, Member } from "./types";

type ApiResult<T> = { data: T; demo: boolean };
const DEMO_KEY = "fc-paejae-demo";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) }, ...options });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "요청을 처리하지 못했어요.");
  return body;
}

export async function createRoom(input: { roomName: string; players: string[]; pin?: string }): Promise<ApiResult<{ room: { code: string; name: string }; member: Member }>> {
  try { return { data: await request("/api/rooms", { method: "POST", body: JSON.stringify(input) }), demo: false }; }
  catch { return { data: demoCreate(input), demo: true }; }
}

export async function joinRoom(code: string, input: { name: string; pin?: string }): Promise<ApiResult<{ room: { code: string; name: string }; member: Member }>> {
  try { return { data: await request(`/api/rooms/${code}/join`, { method: "POST", body: JSON.stringify(input) }), demo: false }; }
  catch { return { data: demoJoin(code, input.name), demo: true }; }
}

export async function getDashboard(code: string, month: string): Promise<ApiResult<Dashboard>> {
  try { return { data: await request(`/api/rooms/${code}/dashboard?month=${month}`), demo: false }; }
  catch { return { data: demoDashboard(code, month), demo: true }; }
}

export async function addLoss(code: string, input: { loserId: string; amount: number; playedAt: string; memo: string }): Promise<ApiResult<{ id: string }>> {
  try { return { data: await request(`/api/rooms/${code}/losses`, { method: "POST", body: JSON.stringify(input) }), demo: false }; }
  catch { return { data: demoAddLoss(code, input), demo: true }; }
}

export async function deleteLoss(code: string, lossId: string): Promise<void> {
  try { await request(`/api/rooms/${code}/losses/${lossId}`, { method: "DELETE" }); }
  catch { demoDeleteLoss(code, lossId); }
}

export async function completeSettlement(code: string, month: string): Promise<void> {
  try { await request(`/api/rooms/${code}/settlements/${month}/complete`, { method: "POST" }); }
  catch { demoSettle(code, month, "PAID"); }
}

export async function reopenSettlement(code: string, month: string): Promise<void> {
  try { await request(`/api/rooms/${code}/settlements/${month}/reopen`, { method: "POST" }); }
  catch { demoSettle(code, month, "OPEN"); }
}

type DemoState = { code: string; name: string; members: Member[]; losses: Array<{ id: string; loser_id: string; amount: number; played_at: string; memo: string }>; settled: Record<string, boolean> };
function readDemo(): DemoState | null { const raw = localStorage.getItem(DEMO_KEY); return raw ? JSON.parse(raw) as DemoState : null; }
function writeDemo(state: DemoState): void { localStorage.setItem(DEMO_KEY, JSON.stringify(state)); }
function demoCreate(input: { roomName: string; players: string[] }): { room: { code: string; name: string }; member: Member } {
  const state: DemoState = { code: "DEMO24", name: input.roomName, members: input.players.map((name, i) => ({ id: `demo-${i}`, name, role: i === 0 ? "OWNER" : "MEMBER" })), losses: [], settled: {} };
  writeDemo(state); localStorage.setItem("fc-room", state.code); return { room: { code: state.code, name: state.name }, member: state.members[0] };
}
function demoJoin(code: string, name: string): { room: { code: string; name: string }; member: Member } {
  const state = readDemo(); const members = state?.members ?? [{ id: "demo-0", name, role: "OWNER" as const }, { id: "demo-1", name: "상대방", role: "MEMBER" as const }];
  if (!state) writeDemo({ code: code.toUpperCase(), name: "우리들의 FC 리그", members, losses: [], settled: {} });
  const member = members.find((candidate) => candidate.name === name) ?? members[0]; localStorage.setItem("fc-room", code.toUpperCase()); return { room: { code: code.toUpperCase(), name: state?.name ?? "우리들의 FC 리그" }, member };
}
function demoDashboard(code: string, month: string): Dashboard {
  const state = readDemo() ?? { code, name: "우리들의 FC 리그", members: [{ id: "demo-0", name: "서이삭", role: "OWNER" as const }, { id: "demo-1", name: "신준형", role: "MEMBER" as const }], losses: [], settled: {} };
  const currentMember = state.members[0]; const monthLosses = state.losses.filter((loss) => loss.played_at.startsWith(month));
  const totals = Object.fromEntries(state.members.map((member) => [member.id, monthLosses.filter((loss) => loss.loser_id === member.id).reduce((sum, loss) => sum + loss.amount, 0)]));
  const sorted = state.members.map((member) => [member.id, totals[member.id] ?? 0] as const).sort((a, b) => b[1] - a[1]);
  const base = Math.abs((sorted[0]?.[1] ?? 0) - (sorted[1]?.[1] ?? 0)); const paid = state.settled[month] ?? false;
  return { room: { code: state.code, name: state.name }, currentMember, month, members: state.members, losses: monthLosses.map((loss) => ({ ...loss, loser_name: state.members.find((member) => member.id === loss.loser_id)?.name ?? "" })), totals, settlement: { id: paid ? "demo-settlement" : null, debtorId: base ? sorted[0]?.[0] ?? null : null, creditorId: base ? sorted[1]?.[0] ?? null : null, baseAmount: base, multiplier: paid ? 1 : 1, finalAmount: base, penaltyAt: "", status: paid ? "PAID" : "OPEN", paid_at: paid ? new Date().toISOString() : null }, auditLogs: [] };
}
function demoAddLoss(code: string, input: { loserId: string; amount: number; playedAt: string; memo: string }): { id: string } { const state = readDemo(); if (!state) throw new Error("데모 방을 먼저 만들어 주세요."); const record = { id: crypto.randomUUID(), loser_id: input.loserId, amount: input.amount, played_at: input.playedAt, memo: input.memo }; state.losses.unshift(record); writeDemo(state); return { id: record.id }; }
function demoDeleteLoss(_code: string, lossId: string): void { const state = readDemo(); if (state) { state.losses = state.losses.filter((loss) => loss.id !== lossId); writeDemo(state); } }
function demoSettle(_code: string, month: string, status: "PAID" | "OPEN"): void { const state = readDemo(); if (state) { state.settled[month] = status === "PAID"; writeDemo(state); } }
