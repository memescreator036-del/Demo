// Sends verification and reset codes by email (SMTP) or SMS (Twilio).
// Production: a code is never shown, and an error is raised if no delivery service is configured.
// Development: with no service configured, the code is logged and returned to the caller.
const PROD = process.env.NODE_ENV === "production";
const emailReady = () => !!process.env.SMTP_HOST;
const smsReady = () => !!(process.env.TWILIO_SID && process.env.TWILIO_TOKEN && process.env.TWILIO_FROM);

async function sendCode({ to, code }) {
  const text = `Your Verde & Gold code is ${code}. It expires in 10 minutes. Never share this code with anyone.`;
  if (to.includes("@")) {
    if (emailReady()) {
      const nodemailer = require("nodemailer");
      const port = Number(process.env.SMTP_PORT || 587);
      const t = nodemailer.createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465,
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined });
      await t.sendMail({ from: process.env.SMTP_FROM || "Verde & Gold <no-reply@example.com>", to, subject: "Your verification code", text });
      return { sent: true };
    }
  } else if (smsReady()) {
    const sid = process.env.TWILIO_SID;
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(sid + ":" + process.env.TWILIO_TOKEN).toString("base64"),
                 "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: "+" + to, From: process.env.TWILIO_FROM, Body: text })
    });
    if (!r.ok) throw new Error("SMS provider rejected the message");
    return { sent: true };
  }
  if (PROD) throw new Error("No code delivery service is configured");
  console.log(`[dev] code for ${to}: ${code}`);
  return { sent: false, devCode: code };
}
module.exports = { sendCode };
