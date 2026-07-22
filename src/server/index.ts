import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { calculateSettlement } from "../shared/settlement";

type Env = { Bindings: { DB: D1Database; ASSETS: Fetcher; AUTH_PEPPER?: string } };
type MemberRow = { id: string; name: string; role: "OWNER" | "MEMBER" };
type LossRow = { id: string; loser_id: string; amount: number; played_at: string; memo: string; loser_name: string };
type SettlementRow = { id: string; debtor_id: string | null; creditor_id: string | null; base_amount: number; multiplier: number; final_amount: number; status: "OPEN" | "PAID"; paid_at: string | null };
type AppContext = Context<Env>;

const app = new Hono<Env>();
const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const roomCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const json = (value: unknown) => JSON.stringify(value);
const cookieOptions = (c: AppContext) => ({ httpOnly: true, sameSite: "Lax" as const, secure: new URL(c.req.url).protocol === "https:", maxAge: 60 * 60 * 24 * 90, path: "/" });

async function hash(value: string, pepper = "local-dev-pepper"): Promise<string> {
  const bytes = new TextEncoder().encode(`${pepper}:${value}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fail(c: AppContext, message: string, status: ContentfulStatusCode = 400) {
  return c.json({ error: message }, status);
}

async function actor(c: AppContext, code: string): Promise<MemberRow | null> {
  const token = getCookie(c, "fc_session");
  if (!token) return null;
  const tokenHash = await hash(token, c.env.AUTH_PEPPER);
  const result = await c.env.DB.prepare(`SELECT m.id, m.name, m.role FROM sessions s JOIN members m ON m.id = s.member_id JOIN rooms r ON r.id = s.room_id WHERE r.code = ? AND s.token_hash = ? AND s.expires_at > ?`).bind(code, tokenHash, now()).first<MemberRow>();
  return result ?? null;
}

async function audit(db: D1Database, roomId: string, actorId: string, action: string, entityType: string, entityId: string, metadata: Record<string, unknown> = {}) {
  await db.prepare(`INSERT INTO audit_logs (id, room_id, actor_id, action, entity_type, entity_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(id(), roomId, actorId, action, entityType, entityId, json(metadata), now()).run();
}

async function roomByCode(db: D1Database, code: string) {
  return db.prepare(`SELECT id, code, name, owner_member_id FROM rooms WHERE code = ?`).bind(code.toUpperCase()).first<{ id: string; code: string; name: string; owner_member_id: string }>();
}

async function monthSummary(db: D1Database, roomId: string, month: string) {
  const members = await db.prepare(`SELECT id, name, role FROM members WHERE room_id = ? ORDER BY created_at`).bind(roomId).all<MemberRow>();
  const losses = await db.prepare(`SELECT l.id, l.loser_id, l.amount, l.played_at, l.memo, m.name AS loser_name FROM loss_records l JOIN members m ON m.id = l.loser_id WHERE l.room_id = ? AND substr(l.played_at, 1, 7) = ? ORDER BY l.played_at DESC, l.created_at DESC`).bind(roomId, month).all<LossRow>();
  const totals = Object.fromEntries(members.results.map((member) => [member.id, 0]));
  for (const loss of losses.results) totals[loss.loser_id] = (totals[loss.loser_id] ?? 0) + loss.amount;
  const settlement = await db.prepare(`SELECT id, debtor_id, creditor_id, base_amount, multiplier, final_amount, status, paid_at FROM settlements WHERE room_id = ? AND month = ?`).bind(roomId, month).first<SettlementRow>();
  const calculation = calculateSettlement({ month, totals, settlementStatus: settlement?.status ?? "OPEN", settledFinalAmount: settlement?.final_amount, now: new Date() });
  return { month, members: members.results, losses: losses.results, totals, settlement: settlement ? { ...settlement, ...calculation, status: settlement.status } : { ...calculation, status: "OPEN" as const, paid_at: null, id: null } };
}

const roomSchema = z.object({ roomName: z.string().trim().min(1).max(40), players: z.array(z.string().trim().min(1).max(20)).length(2), pin: z.string().regex(/^\d{4,6}$/).optional() });
const joinSchema = z.object({ name: z.string().trim().min(1).max(20), pin: z.string().regex(/^\d{4,6}$/).optional() });
const lossSchema = z.object({ loserId: z.string().min(1), amount: z.number().int().min(100).max(1000000), playedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), memo: z.string().trim().max(120).default("") });

app.get("/api/health", (c) => c.json({ ok: true, service: "fc-paejae-jeogeumso" }));

app.post("/api/rooms", zValidator("json", roomSchema), async (c) => {
  const input = c.req.valid("json");
  const roomId = id();
  const createdAt = now();
  const members = input.players.map((name, index) => ({ id: id(), name, role: index === 0 ? "OWNER" : "MEMBER" as const }));
  const pinHash = input.pin ? await hash(input.pin, c.env.AUTH_PEPPER) : null;
  const code = roomCode();
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO rooms (id, code, name, owner_member_id, created_at) VALUES (?, ?, ?, ?, ?)`).bind(roomId, code, input.roomName, members[0].id, createdAt),
    ...members.map((member) => c.env.DB.prepare(`INSERT INTO members (id, room_id, name, role, pin_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)`).bind(member.id, roomId, member.name, member.role, pinHash, createdAt)),
  ]);
  const token = crypto.randomUUID();
  await c.env.DB.prepare(`INSERT INTO sessions (id, room_id, member_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`).bind(id(), roomId, members[0].id, await hash(token, c.env.AUTH_PEPPER), new Date(Date.now() + 1000 * 60 * 60 * 24 * 90).toISOString(), createdAt).run();
  setCookie(c, "fc_session", token, cookieOptions(c));
  return c.json({ room: { code, name: input.roomName }, member: members[0] }, 201);
});

app.post("/api/rooms/:code/join", zValidator("json", joinSchema), async (c) => {
  const code = c.req.param("code").toUpperCase();
  const input = c.req.valid("json");
  const room = await roomByCode(c.env.DB, code);
  if (!room) return fail(c, "방 코드를 찾을 수 없어요.", 404);
  const member = await c.env.DB.prepare(`SELECT id, name, role, pin_hash FROM members WHERE room_id = ? AND name = ?`).bind(room.id, input.name).first<MemberRow & { pin_hash: string | null }>();
  if (!member) return fail(c, "참여자 이름을 확인해 주세요.", 404);
  if (member.pin_hash && (!input.pin || member.pin_hash !== await hash(input.pin, c.env.AUTH_PEPPER))) return fail(c, "PIN이 맞지 않아요.", 401);
  const token = crypto.randomUUID();
  await c.env.DB.prepare(`INSERT INTO sessions (id, room_id, member_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`).bind(id(), room.id, member.id, await hash(token, c.env.AUTH_PEPPER), new Date(Date.now() + 1000 * 60 * 60 * 24 * 90).toISOString(), now()).run();
  setCookie(c, "fc_session", token, cookieOptions(c));
  return c.json({ room: { code: room.code, name: room.name }, member: { id: member.id, name: member.name, role: member.role } });
});

app.get("/api/rooms/:code/dashboard", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const current = await actor(c, code);
  if (!current) return fail(c, "먼저 방에 참여해 주세요.", 401);
  const room = await roomByCode(c.env.DB, code);
  if (!room) return fail(c, "방을 찾을 수 없어요.", 404);
  const month = c.req.query("month") ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).format(new Date());
  const summary = await monthSummary(c.env.DB, room.id, month);
  const logs = await c.env.DB.prepare(`SELECT a.id, a.action, a.entity_type, a.entity_id, a.metadata, a.created_at, m.name AS actor_name FROM audit_logs a JOIN members m ON m.id = a.actor_id WHERE a.room_id = ? ORDER BY a.created_at DESC LIMIT 30`).bind(room.id).all<Record<string, unknown>>();
  return c.json({ room: { code: room.code, name: room.name }, currentMember: current, ...summary, auditLogs: logs.results });
});

app.post("/api/rooms/:code/losses", zValidator("json", lossSchema), async (c) => {
  const code = c.req.param("code").toUpperCase();
  const current = await actor(c, code);
  if (!current) return fail(c, "먼저 방에 참여해 주세요.", 401);
  const room = await roomByCode(c.env.DB, code);
  if (!room) return fail(c, "방을 찾을 수 없어요.", 404);
  const input = c.req.valid("json");
  const member = await c.env.DB.prepare(`SELECT id FROM members WHERE id = ? AND room_id = ?`).bind(input.loserId, room.id).first<{ id: string }>();
  if (!member) return fail(c, "패배자 정보가 올바르지 않아요.");
  const recordId = id();
  await c.env.DB.prepare(`INSERT INTO loss_records (id, room_id, loser_id, amount, played_at, memo, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(recordId, room.id, input.loserId, input.amount, input.playedAt, input.memo, current.id, now(), now()).run();
  await audit(c.env.DB, room.id, current.id, "LOSS_CREATED", "loss", recordId, input);
  return c.json({ id: recordId }, 201);
});

app.patch("/api/rooms/:code/losses/:lossId", zValidator("json", lossSchema), async (c) => {
  const code = c.req.param("code").toUpperCase();
  const current = await actor(c, code);
  if (!current) return fail(c, "먼저 방에 참여해 주세요.", 401);
  const room = await roomByCode(c.env.DB, code);
  if (!room) return fail(c, "방을 찾을 수 없어요.", 404);
  const input = c.req.valid("json");
  const lossId = c.req.param("lossId");
  const loss = await c.env.DB.prepare(`SELECT id FROM loss_records WHERE id = ? AND room_id = ?`).bind(lossId, room.id).first<{ id: string }>();
  if (!loss) return fail(c, "기록을 찾을 수 없어요.", 404);
  await c.env.DB.prepare(`UPDATE loss_records SET loser_id = ?, amount = ?, played_at = ?, memo = ?, updated_at = ? WHERE id = ?`).bind(input.loserId, input.amount, input.playedAt, input.memo, now(), lossId).run();
  await audit(c.env.DB, room.id, current.id, "LOSS_UPDATED", "loss", lossId, input);
  return c.json({ ok: true });
});

app.delete("/api/rooms/:code/losses/:lossId", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const current = await actor(c, code);
  if (!current) return fail(c, "먼저 방에 참여해 주세요.", 401);
  const room = await roomByCode(c.env.DB, code);
  if (!room) return fail(c, "방을 찾을 수 없어요.", 404);
  const lossId = c.req.param("lossId");
  const loss = await c.env.DB.prepare(`SELECT id FROM loss_records WHERE id = ? AND room_id = ?`).bind(lossId, room.id).first<{ id: string }>();
  if (!loss) return fail(c, "기록을 찾을 수 없어요.", 404);
  await c.env.DB.prepare(`DELETE FROM loss_records WHERE id = ?`).bind(lossId).run();
  await audit(c.env.DB, room.id, current.id, "LOSS_DELETED", "loss", lossId);
  return c.json({ ok: true });
});

app.post("/api/rooms/:code/settlements/:month/complete", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const current = await actor(c, code);
  if (!current) return fail(c, "먼저 방에 참여해 주세요.", 401);
  const room = await roomByCode(c.env.DB, code);
  if (!room || room.owner_member_id !== current.id) return fail(c, "방장만 정산을 완료할 수 있어요.", 403);
  const month = c.req.param("month");
  const summary = await monthSummary(c.env.DB, room.id, month);
  if (summary.settlement.status === "PAID") return fail(c, "이미 완료된 정산이에요.", 409);
  const settled = { ...summary.settlement, status: "PAID" as const };
  const settlementId = summary.settlement.id ?? id();
  await c.env.DB.prepare(`INSERT INTO settlements (id, room_id, month, debtor_id, creditor_id, base_amount, multiplier, final_amount, status, paid_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PAID', ?, ?, ?) ON CONFLICT(room_id, month) DO UPDATE SET debtor_id=excluded.debtor_id, creditor_id=excluded.creditor_id, base_amount=excluded.base_amount, multiplier=excluded.multiplier, final_amount=excluded.final_amount, status='PAID', paid_at=excluded.paid_at, updated_at=excluded.updated_at`).bind(settlementId, room.id, month, settled.debtorId, settled.creditorId, settled.baseAmount, settled.multiplier, settled.finalAmount, now(), now(), now()).run();
  await audit(c.env.DB, room.id, current.id, "SETTLEMENT_COMPLETED", "settlement", settlementId, { month, finalAmount: settled.finalAmount });
  return c.json({ settlement: settled });
});

app.post("/api/rooms/:code/settlements/:month/reopen", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const current = await actor(c, code);
  if (!current) return fail(c, "먼저 방에 참여해 주세요.", 401);
  const room = await roomByCode(c.env.DB, code);
  if (!room || room.owner_member_id !== current.id) return fail(c, "방장만 정산을 다시 열 수 있어요.", 403);
  const month = c.req.param("month");
  const settlement = await c.env.DB.prepare(`SELECT id FROM settlements WHERE room_id = ? AND month = ?`).bind(room.id, month).first<{ id: string }>();
  if (!settlement) return fail(c, "완료된 정산이 없어요.", 404);
  await c.env.DB.prepare(`UPDATE settlements SET status = 'OPEN', updated_at = ? WHERE id = ?`).bind(now(), settlement.id).run();
  await audit(c.env.DB, room.id, current.id, "SETTLEMENT_REOPENED", "settlement", settlement.id, { month });
  return c.json({ ok: true });
});

app.all("*", async (c) => c.env.ASSETS.fetch(c.req.raw));

export default { fetch: app.fetch };
