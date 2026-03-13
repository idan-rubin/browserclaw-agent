import { type NextRequest, NextResponse } from "next/server";
import { requireEnv, backendHeaders } from "@/lib/env";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const backendUrl = requireEnv("BACKEND_URL");

  try {
    const body = await request.json();
    const res = await fetch(`${backendUrl}/api/v1/sessions/${id}/respond`, {
      method: "POST",
      headers: {
        ...backendHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
}
