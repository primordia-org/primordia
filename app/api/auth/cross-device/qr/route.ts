// app/api/auth/cross-device/qr/route.ts
// Returns an SVG QR code that encodes the approval URL for the given tokenId.
// Generating the QR on the server keeps the client bundle lean and avoids
// leaking the token URL to any third-party QR service.

import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { getDb } from "@/lib/db/index";

export async function GET(request: NextRequest) {
  try {
    const tokenId = request.nextUrl.searchParams.get("tokenId");
    if (!tokenId) {
      return NextResponse.json({ error: "Missing tokenId" }, { status: 400 });
    }

    // Validate the token exists before generating the QR.
    const db = await getDb();
    const token = await db.getCrossDeviceToken(tokenId);
    if (!token || token.expiresAt < Date.now()) {
      return NextResponse.json({ error: "Token not found or expired" }, { status: 404 });
    }

    // Build the approval URL — e.g. https://primordia.example.com/login/approve?token=<id>
    const approvalUrl = `${request.nextUrl.origin}/login/approve?token=${tokenId}`;

    const svg = await QRCode.toString(approvalUrl, {
      type: "svg",
      margin: 2,
      color: {
        dark: "#ffffff",  // white modules (dark theme)
        light: "#111827", // gray-900 background to match the card
      },
    });

    return new NextResponse(svg, {
      headers: {
        "Content-Type": "image/svg+xml",
        // Short cache: allow the browser to reuse within the same page load but
        // don't cache across reloads (token may have changed).
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (err) {
    console.error("[cross-device/qr]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
