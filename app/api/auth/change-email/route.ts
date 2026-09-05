import { NextResponse } from "next/server";
import { consumeEmailChange } from "@/lib/account";

/**
 * The link the user taps in the NEW email address to confirm an address
 * change. If the token is valid and still fresh, we swap the address on the
 * user record. The user's current session cookie continues to work — the
 * change is invisible to them apart from the address printed on their
 * Account page.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const result = await consumeEmailChange(token);
  return NextResponse.redirect(
    new URL(result.ok ? "/game/account?email-changed=1" : "/game/account?error=email-link", request.url)
  );
}
