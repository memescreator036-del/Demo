// Verde & Gold API. Storage: SQLite (db.js). Read the README before going live.
const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const { db, getContent, setContent } = require("./db");

const app = express();
const SECRET = process.env.JWT_SECRET || "dev-only-change-me";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-me-now";
const DEV = process.env.NODE_ENV !== "production";
if (!DEV && (SECRET === "dev-only-change-me" || SECRET.length < 32 || ADMIN_PASSWORD === "change-me-now")) {
  console.error("Refusing to start in production: set JWT_SECRET (32+ characters) and ADMIN_PASSWORD.");
  process.exit(1);
}
const SITE_URL = process.env.SITE_URL || "http://localhost:8080";
const DELIVERY_FEE = 10;
const stripe = process.env.STRIPE_SECRET_KEY ? require("stripe")(process.env.STRIPE_SECRET_KEY) : null;

// CORS and JSON. The Stripe webhook needs the raw body, so it skips JSON parsing.
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } }));
const CORS_ORIGIN = process.env.CORS_ORIGIN || SITE_URL;
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.set("Access-Control-Allow-Credentials", "true");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,OPTIONS");
  res.vary("Origin");
  if (req.method === "OPTIONS") return res.end();
  next();
});
app.use((req, res, next) => req.path === "/webhooks/stripe" ? next() : express.json({ limit: "100kb" })(req, res, next));
// Sessions use cookies, so every change must be a JSON request. A cross-site form cannot send JSON,
// and browsers block cross-site JSON requests unless CORS allows them. This protects against forged requests.
app.use((req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && req.path !== "/webhooks/stripe" &&
      !(req.headers["content-type"] || "").includes("application/json"))
    return res.status(415).json({ error: "Unsupported request" });
  next();
});
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30 });
app.use("/auth", limiter);
app.use("/admin/login", limiter);

const now = () => Date.now();
const newCode = () => String(crypto.randomInt(100000, 999999));
const norm = s => { const v = String(s || "").trim().toLowerCase(); return v.includes("@") ? v : v.replace(/\D/g, ""); };
const phoneKey = p => String(p || "").replace(/\D/g, "");

const cookiesOf = req => Object.fromEntries((req.headers.cookie || "").split(";").map(c => c.trim().split("=")).filter(p => p.length === 2).map(([k, v]) => [k, decodeURIComponent(v)]));
const cookieAttrs = () => `Path=/; HttpOnly; SameSite=Strict${DEV ? "" : "; Secure"}`;
const setSession = (res, name, value, maxAgeSec) => res.append("Set-Cookie", `${name}=${encodeURIComponent(value)}; ${cookieAttrs()}; Max-Age=${maxAgeSec}`);
const clearSession = (res, name) => res.append("Set-Cookie", `${name}=; ${cookieAttrs()}; Max-Age=0`);
const verifyCookie = (req, name) => { try { return jwt.verify(cookiesOf(req)[name] || "", SECRET); } catch { return null; } };
function requireUser(req, res, next) {
  const p = verifyCookie(req, "vg_session");
  if (!p || !p.sub) return res.status(401).json({ error: "Please sign in" });
  req.userId = p.sub; next();
}
function requireAdmin(req, res, next) {
  const p = verifyCookie(req, "vg_admin");
  if (!p || p.role !== "admin") return res.status(401).json({ error: "Admin sign-in required" });
  next();
}
const findUser = id => db.prepare("SELECT * FROM users WHERE email = ? OR phone = ?").get(id, id);
const setCode = (key, code, minutes, payload) =>
  db.prepare("INSERT OR REPLACE INTO codes (key, code, expires_at, payload) VALUES (?, ?, ?, ?)").run(key, code, now() + minutes * 60e3, payload ? JSON.stringify(payload) : null);
const getCode = key => db.prepare("SELECT * FROM codes WHERE key = ?").get(key);
const validCode = (row, code) => row && row.expires_at > now() && row.code === code;

// ---------- Accounts ----------
const { sendCode } = require("./notify");
const validContact = id => id.includes("@") ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id) : /^\d{8,15}$/.test(id);
// Sends a code first, then stores it. If sending fails, nothing is stored.
async function issue(key, to, minutes, payload) {
  const code = newCode();
  const r = await sendCode({ to, code });
  setCode(key, code, minutes, payload);
  return r.devCode ? { devCode: r.devCode } : {};
}
// Returns the stored code row if the code is right, unexpired, and under 5 wrong guesses.
const checkCode = (key, code) => {
  const row = getCode(key);
  if (!row || row.expires_at <= now() || row.attempts >= 5) return null;
  if (row.code !== String(code || "")) { db.prepare("UPDATE codes SET attempts = attempts + 1 WHERE key = ?").run(key); return null; }
  return row;
};
const sendFailed = res => res.status(503).json({ error: "We could not send your code right now. Please try again shortly." });

app.post("/auth/signup", async (req, res) => {
  const id = norm(req.body.identifier), name = (req.body.name || "").trim(), password = req.body.password || "";
  if (!id || !name || password.length < 8) return res.status(400).json({ error: "Please complete all fields. Password needs 8+ characters." });
  if (!validContact(id)) return res.status(400).json({ error: "Enter a valid email address or mobile number" });
  if (findUser(id)) return res.status(409).json({ error: "An account already exists for this email or phone" });
  try {
    const payload = { name, passHash: await bcrypt.hash(password, 12), isEmail: id.includes("@") };
    res.json({ ok: true, ...(await issue("verify:" + id, id, 10, payload)) });
  } catch (e) { console.error("signup code:", e.message); sendFailed(res); }
});
app.post("/auth/verify", (req, res) => {
  const id = norm(req.body.identifier);
  const row = checkCode("verify:" + id, req.body.code);
  if (!row) return res.status(400).json({ error: "Code incorrect or expired" });
  const p = JSON.parse(row.payload);
  try {
    db.prepare("INSERT INTO users (id, name, email, phone, pass_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(crypto.randomUUID(), p.name, p.isEmail ? id : null, p.isEmail ? null : id, p.passHash, new Date().toISOString());
  } catch { return res.status(409).json({ error: "An account already exists for this email or phone" }); }
  db.prepare("DELETE FROM codes WHERE key = ?").run("verify:" + id);
  res.status(201).json({ ok: true });
});
app.post("/auth/login", async (req, res) => {
  const user = findUser(norm(req.body.identifier));
  if (!user || !(await bcrypt.compare(req.body.password || "", user.pass_hash)))
    return res.status(401).json({ error: "Details not recognised" });
  if (user.two_fa) {
    const key = "2fa:" + user.id;
    if (!req.body.code) {
      try { return res.status(202).json({ twoFactorRequired: true, ...(await issue(key, user.email || user.phone, 5)) }); }
      catch (e) { console.error("2fa code:", e.message); return sendFailed(res); }
    }
    if (!checkCode(key, req.body.code)) return res.status(401).json({ error: "Two-factor code incorrect or expired" });
    db.prepare("DELETE FROM codes WHERE key = ?").run(key);
  }
  setSession(res, "vg_session", jwt.sign({ sub: user.id }, SECRET, { expiresIn: "2h" }), 2 * 3600);
  res.json({ ok: true });
});
app.post("/auth/logout", (req, res) => { clearSession(res, "vg_session"); res.json({ ok: true }); });
app.post("/auth/reset-request", async (req, res) => {
  const user = findUser(norm(req.body.identifier));
  let extra = {};
  if (user) {
    try { extra = await issue("reset:" + user.id, user.email || user.phone, 10); }
    catch (e) { console.error("reset code:", e.message); }
  }
  // Same reply whether or not the account exists, so the endpoint does not reveal who has an account.
  res.json({ ok: true, ...(DEV && extra) });
});
app.post("/auth/reset", async (req, res) => {
  const user = findUser(norm(req.body.identifier));
  if (!user || !checkCode("reset:" + user.id, req.body.code) || (req.body.newPassword || "").length < 8)
    return res.status(400).json({ error: "Code incorrect, expired, or password too short" });
  db.prepare("UPDATE users SET pass_hash = ? WHERE id = ?").run(await bcrypt.hash(req.body.newPassword, 12), user.id);
  db.prepare("DELETE FROM codes WHERE key = ?").run("reset:" + user.id);
  res.json({ ok: true });
});
app.get("/me", requireUser, (req, res) => {
  const u = db.prepare("SELECT id, name, email, phone, two_fa FROM users WHERE id = ?").get(req.userId);
  if (!u) return res.status(404).json({ error: "Not found" });
  res.json({ id: u.id, name: u.name, email: u.email, phone: u.phone, twoFA: !!u.two_fa });
});
app.patch("/me/2fa", requireUser, (req, res) => {
  db.prepare("UPDATE users SET two_fa = ? WHERE id = ?").run(req.body.enabled ? 1 : 0, req.userId);
  res.json({ ok: true });
});

// ---------- Site content (public read, admin write) ----------
app.get("/content", (req, res) => res.json(getContent()));
const passwordOk = given => { const a = Buffer.from(String(given || "")), b = Buffer.from(ADMIN_PASSWORD); return a.length === b.length && crypto.timingSafeEqual(a, b); };
app.post("/admin/login", (req, res) => {
  if (!passwordOk(req.body.password)) return res.status(401).json({ error: "Incorrect password" });
  setSession(res, "vg_admin", jwt.sign({ role: "admin" }, SECRET, { expiresIn: "8h" }), 8 * 3600);
  res.json({ ok: true });
});
app.post("/admin/logout", (req, res) => { clearSession(res, "vg_admin"); res.json({ ok: true }); });
app.put("/admin/content", requireAdmin, (req, res) => {
  const c = req.body;
  if (!c || !c.general || !Array.isArray(c.menu) || !Array.isArray(c.hours) || !c.reservations)
    return res.status(400).json({ error: "Invalid content" });
  if (c.menu.some(m => !(Number(m.price) >= 0))) return res.status(400).json({ error: "Menu prices must be numbers" });
  setContent(c);
  res.json({ ok: true });
});

// ---------- Reservations ----------
app.post("/reservations", (req, res) => {
  const { name, phone, email, date, time, notes } = req.body, guests = Number(req.body.guests), r = getContent().reservations;
  if (!name || !phone || !date || !time) return res.status(400).json({ error: "Please fill in all required fields" });
  if (!(guests >= 1 && guests <= r.maxGuests)) return res.status(400).json({ error: `Guests must be between 1 and ${r.maxGuests}` });
  if (time < r.open || time > r.close) return res.status(400).json({ error: "That time is outside opening hours" });
  const when = new Date(`${date}T${time}:00`);
  if (isNaN(when) || when < new Date(now() + r.leadHours * 3600e3)) return res.status(400).json({ error: `Please book at least ${r.leadHours} hours ahead` });
  const id = "R" + now().toString(36).toUpperCase();
  db.prepare("INSERT INTO reservations (id, name, phone, email, date, time, guests, notes, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)")
    .run(id, name, phone, email || "", date, time, guests, notes || "", new Date().toISOString());
  res.status(201).json({ id, status: "pending" });
});
app.get("/admin/reservations", requireAdmin, (req, res) =>
  res.json(db.prepare("SELECT * FROM reservations ORDER BY created_at DESC").all()));
app.patch("/admin/reservations/:id", requireAdmin, (req, res) => {
  if (!["pending", "confirmed", "cancelled"].includes(req.body.status)) return res.status(400).json({ error: "Invalid status" });
  const r = db.prepare("UPDATE reservations SET status = ? WHERE id = ?").run(req.body.status, req.params.id);
  if (!r.changes) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

// ---------- Orders and payments ----------

const orderView = o => ({ ...o, lines: JSON.parse(o.lines), optIn: !!o.opt_in });
// Returns the signed-in customer's id, or null for guests. Guests can still order.
const optionalUser = req => verifyCookie(req, "vg_session")?.sub || null;
// Marks an order paid once. Loyalty points are calculated from paid orders, so nothing else needs updating.
const markPaid = id => db.prepare("UPDATE orders SET status = 'paid' WHERE id = ? AND status != 'paid'").run(id).changes > 0;

app.post("/orders", async (req, res) => {
  const { items, mode, address, name, phone, time, notes, payment, displayName, optIn } = req.body;
  const content = getContent(), userId = optionalUser(req);
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "Your basket is empty" });
  if (!name || phoneKey(phone).length < 8) return res.status(400).json({ error: "Name and mobile number are required" });
  if (mode === "delivery" && !address) return res.status(400).json({ error: "Delivery address is required" });
  const lines = [];
  for (const it of items) {
    const m = content.menu.find(x => x.id === it.id), qty = Number(it.qty);
    if (!m || !m.available) return res.status(400).json({ error: "An item is no longer available" });
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) return res.status(400).json({ error: "Quantities must be 1 to 20" });
    lines.push({ name: m.name, qty, price: Number(m.price) });
  }
  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0), fee = mode === "delivery" ? DELIVERY_FEE : 0;
  const o = {
    id: "O" + now().toString(36).toUpperCase(), ref: "VG-" + crypto.randomBytes(3).toString("hex").toUpperCase(),
    lines: JSON.stringify(lines), subtotal, fee, total: subtotal + fee, mode, address: address || "",
    name, phone: phoneKey(phone), time: time || "asap", notes: notes || "",
    display_name: optIn ? (displayName || name).slice(0, 24) : "", opt_in: optIn ? 1 : 0,
    user_id: userId, created_at: new Date().toISOString()
  };
  const insert = (status, session) => db.prepare(`INSERT INTO orders (id, ref, lines, subtotal, fee, total, mode, address, name, phone, time, notes,
    display_name, opt_in, status, stripe_session, user_id, created_at) VALUES (@id, @ref, @lines, @subtotal, @fee, @total, @mode, @address, @name,
    @phone, @time, @notes, @display_name, @opt_in, @status, @session, @user_id, @created_at)`).run({ ...o, status, session: session || null });

  if (payment === "card") {
    if (!stripe) return res.status(503).json({ error: "Card payment is not set up yet. Please choose pay on arrival." });
    try {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [
          ...lines.map(l => ({ quantity: l.qty, price_data: { currency: "aed", unit_amount: Math.round(l.price * 100), product_data: { name: l.name } } })),
          ...(fee ? [{ quantity: 1, price_data: { currency: "aed", unit_amount: fee * 100, product_data: { name: "Delivery" } } }] : [])
        ],
        success_url: `${SITE_URL}/checkout.html?order=${o.id}&status=success`,
        cancel_url: `${SITE_URL}/checkout.html?order=${o.id}&status=cancelled`,
        metadata: { orderId: o.id }
      });
      insert("awaiting_payment", session.id);
      return res.status(201).json({ id: o.id, checkoutUrl: session.url });
    } catch { return res.status(502).json({ error: "Payment provider error. Please try again." }); }
  }
  insert("pay_on_arrival");
  res.status(201).json({ id: o.id, status: "pay_on_arrival", ref: o.ref, total: o.total });
});

// Stripe calls this. The signature is checked before any order is changed.
app.post("/webhooks/stripe", express.raw({ type: "application/json" }), (req, res) => {
  if (!stripe) return res.status(404).end();
  let event;
  try { event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET); }
  catch { return res.status(400).end(); }
  if (event.type === "checkout.session.completed") markPaid(event.data.object.metadata.orderId);
  res.json({ received: true });
});

app.get("/orders/:id", (req, res) => {
  const o = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
  if (!o) return res.status(404).json({ error: "Order not found" });
  res.json({ id: o.id, ref: o.ref, status: o.status, total: o.total, mode: o.mode });
});
app.get("/leaderboard", (req, res) => res.json(db.prepare(`
  SELECT MAX(CASE WHEN opt_in = 1 THEN display_name END) AS name, SUM(CAST(total AS INTEGER)) AS points
  FROM orders WHERE status = 'paid' GROUP BY phone HAVING MAX(opt_in) = 1
  ORDER BY points DESC LIMIT 10`).all()));

app.get("/admin/orders", requireAdmin, (req, res) =>
  res.json(db.prepare("SELECT * FROM orders ORDER BY created_at DESC").all().map(orderView)));
app.patch("/admin/orders/:id", requireAdmin, (req, res) => {
  const o = db.prepare("SELECT id FROM orders WHERE id = ?").get(req.params.id);
  if (!o) return res.status(404).json({ error: "Not found" });
  const s = req.body.status;
  if (s === "paid") markPaid(o.id);
  else if (["pay_on_arrival", "cancelled", "completed"].includes(s)) db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(s, o.id);
  else return res.status(400).json({ error: "Invalid status" });
  res.json({ ok: true });
});


// ---------- Customer account: own orders and points ----------
app.get("/me/orders", requireUser, (req, res) => res.json(
  db.prepare("SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC").all(req.userId).map(orderView).map(o => ({
    id: o.id, ref: o.ref, status: o.status, total: o.total, mode: o.mode, lines: o.lines, createdAt: o.created_at }))));
app.get("/me/points", requireUser, (req, res) => {
  const r = db.prepare("SELECT COALESCE(SUM(CAST(total AS INTEGER)), 0) AS points, COUNT(*) AS paidOrders FROM orders WHERE user_id = ? AND status = 'paid'").get(req.userId);
  res.json({ points: r.points, paidOrders: r.paidOrders, rule: "1 point per AED spent on paid orders" });
});

app.get("/health", (req, res) => res.json({ ok: true }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.type === "entity.too.large" ? "Request too large" : "Something went wrong" });
});

app.listen(process.env.PORT || 3000, () => console.log("Verde & Gold API on port", process.env.PORT || 3000));
