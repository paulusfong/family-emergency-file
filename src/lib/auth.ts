import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";
import { resolveAuthSecret } from "./auth-secret";
import { resolveBaseURL } from "./base-url";
import { db } from "./db";
import * as schema from "./schema";
import { sendMail } from "./mail";

const baseURL = resolveBaseURL(process.env);

export const auth = betterAuth({
  secret: resolveAuthSecret(process.env),
  baseURL,
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema,
  }),
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  rateLimit: {
    window: 180,
    max: 5,
  },
  plugins: [
    magicLink({
      expiresIn: 60 * 30,
      storeToken: "hashed",
      disableSignUp: false,
      sendMagicLink: async ({ email, token }) => {
        const confirm = new URL("/sign-in/confirm", baseURL);
        confirm.searchParams.set("token", token);
        await sendMail(
          email,
          "Sign in to Family Emergency File",
          `Sign in to Family Emergency File:\n\n${confirm.toString()}\n\nThis link expires in 30 minutes. If you did not request it, ignore this email.`,
        );
      },
    }),
    nextCookies(),
  ],
});
