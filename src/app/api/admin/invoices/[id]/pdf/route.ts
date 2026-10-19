import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin/auth";
import { buildInvoicePdf } from "@/lib/admin/invoice-email";

/**
 * An invoice as the PDF the client receives, for the admin's invoice window.
 * Admins only. Shown inline so the window can display it; `?download=1`
 * saves it instead.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("edos-centre");
  } catch {
    return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  }

  const { id } = await params;
  const pdf = await buildInvoicePdf(id);
  if (!pdf) return NextResponse.json({ error: "Invoice not found." }, { status: 404 });

  const download = request.nextUrl.searchParams.get("download") === "1";
  const filename = `${pdf.number.replace(/[^\w.-]/g, "_")}.pdf`;
  return new Response(pdf.bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
