import fs from "node:fs";
import path from "node:path";

export function mailFrom(env: Record<string, string | undefined>): string {
  return env.MAIL_FROM ?? "Family Emergency File <noreply@localhost>";
}

export function isProductionMailEnv(env: Record<string, string | undefined>): boolean {
  return env.NODE_ENV === "production" || env.VERCEL === "1";
}

/**
 * Send outbound email. Fail-closed in production/Vercel without RESEND_API_KEY.
 * In local/dev without Resend: log the body and write tmp/last-magic-link.txt when
 * the body contains a sign-in URL.
 */
export async function sendMail(
  to: string,
  subject: string,
  text: string,
  env: Record<string, string | undefined> = process.env,
) {
  const key = env.RESEND_API_KEY;
  if (key) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: mailFrom(env), to, subject, text }),
    });
    if (!res.ok) {
      console.error("Resend failed", res.status);
    }
    return;
  }

  if (isProductionMailEnv(env)) {
    throw new Error("RESEND_API_KEY is required in production");
  }

  console.log(`[mail:dev] To: ${to}\nSubject: ${subject}\n\n${text}`);

  const urlMatch = text.match(/https?:\/\/\S+/);
  if (urlMatch) {
    const dir = path.join(process.cwd(), "tmp");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "last-magic-link.txt"), `${urlMatch[0]}\n`);
  }
}
