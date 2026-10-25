// Consistent database backup (safe while the server is running). Keeps the newest 14 copies.
const fs = require("fs");
const path = require("path");
const { db } = require("./db");

(async () => {
  const dir = path.join(__dirname, "data", "backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `app-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
  await db.backup(file);
  const old = fs.readdirSync(dir).filter(f => f.endsWith(".db")).sort().slice(0, -14);
  old.forEach(f => fs.unlinkSync(path.join(dir, f)));
  console.log("Backup written:", file, old.length ? `(removed ${old.length} old copies)` : "");
})().catch(e => { console.error("Backup failed:", e.message); process.exit(1); });
