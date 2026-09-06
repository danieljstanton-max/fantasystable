/**
 * Sending the sign-in link.
 *
 * Provider-agnostic on purpose, and deliberately not an SDK. Resend's send
 * endpoint is one POST; a dependency to construct it would be a dependency
 * to audit, update and trust with the one credential that can send mail as us.
 *
 * With no key configured the link is written to the server log instead. That is
 * what makes sign-in testable on a laptop before any DNS or sender domain
 * exists, and it is why the log line is unmistakable rather than a quiet
 * console.log — in production a missing key must look like a fault, not like a
 * successful send.
 */

const FROM = process.env.MAIL_FROM ?? "Fantasy Stable <noreply@fantasystable.co.uk>";

export type SendResult = { delivered: boolean; via: "resend" | "log" };

/**
 * Send an arbitrary transactional email. Uses the same Resend endpoint as
 * the sign-in link and falls back to a stderr warning when no API key is
 * configured, so tests and dev environments never silently think a mail
 * went out. Callers own the subject/text/html — this function only cares
 * that Resend accepted it.
 */
export async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn(
      [
        "",
        "  ┌─ NO RESEND_API_KEY — mail not sent ─────────────────────────",
        `  │  to:      ${opts.to}`,
        `  │  subject: ${opts.subject}`,
        "  └────────────────────────────────────────────────────────────",
        "",
      ].join("\n")
    );
    return { delivered: false, via: "log" };
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: [opts.to],
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    }),
  });
  if (!response.ok) throw new Error(`Resend rejected the send (${response.status})`);
  return { delivered: true, via: "resend" };
}

export async function sendSignInLink(email: string, url: string): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;

  if (!key) {
    console.warn(
      [
        "",
        "  ┌─ NO RESEND_API_KEY — sign-in link not emailed ─────────────",
        `  │  to:   ${email}`,
        `  │  link: ${url}`,
        "  └────────────────────────────────────────────────────────────",
        "",
      ].join("\n")
    );
    return { delivered: false, via: "log" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: [email],
      subject: "Your sign-in link",
      text: signInText(url),
      html: signInHtml(url),
    }),
  });

  if (!response.ok) {
    // Never log the response body verbatim — it echoes request headers on some
    // failures, and that is where the API key lives.
    throw new Error(`Resend rejected the send (${response.status})`);
  }
  return { delivered: true, via: "resend" };
}

const signInText = (url: string) =>
  [
    "Tap the link below to sign in and pick your stable.",
    "",
    url,
    "",
    "The link works once and expires in 15 minutes.",
    "If you did not ask for this, ignore it — nothing has been created.",
  ].join("\n");

const signInHtml = (url: string) => `
<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#17303c">
  <h1 style="font-size:20px;margin:0 0 4px">Fantasy Stable</h1>
  <p style="font-size:13px;color:#7d919c;margin:0 0 24px">Pick 6 horses. Chase glory.</p>
  <p style="font-size:15px;line-height:1.5;margin:0 0 24px">Tap below to sign in and pick your stable.</p>
  <p style="margin:0 0 24px">
    <a href="${url}" style="display:inline-block;background:#06b268;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 28px;border-radius:12px">Sign in</a>
  </p>
  <p style="font-size:13px;color:#7d919c;line-height:1.5;margin:0">
    The link works once and expires in 15 minutes.<br>
    If you did not ask for this, ignore it — nothing has been created.
  </p>
</div>`;
