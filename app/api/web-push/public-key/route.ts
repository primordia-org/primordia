import { NextResponse } from "next/server";
import { getOrCreateVapidKeys } from "@/lib/web-push";

/**
 * Get the instance VAPID public key used by browsers to create PushSubscriptions.
 * @description Returns the base64url-encoded P-256 public key for Web Push subscriptions.
 */
export async function GET() {
  const keys = await getOrCreateVapidKeys();
  return NextResponse.json({ publicKey: keys.publicKey });
}
