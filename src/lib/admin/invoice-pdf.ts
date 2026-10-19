import "server-only";
import { jsPDF } from "jspdf";
import { EDOS_MARK_PNG } from "@/lib/admin/edos-mark";
import { vatLabel } from "@/lib/admin/vat";

/**
 * The invoice as a PDF, attached to the client's email.
 *
 * Laid out the way EDOS Poa's plan invoice is — the mark beside the seller's
 * name, the title block on the right, "Billed to", one line with its period,
 * totals, a stamp, and how to pay — so an EDOS invoice looks the same whether
 * it came from the POS or from the website admin. Built on the server with
 * jsPDF, the same library, so there is nothing for the client to render.
 */

export interface InvoicePdfData {
  number: string;
  issueDate: string;
  dueDate: string;
  status: "paid" | "overdue" | "due";
  paidOn?: string | null;
  sellerName: string;
  sellerLines: string[];
  buyerName: string;
  buyerLines: string[];
  line: string;
  detail: string | null;
  currency: string;
  amount: number;
  tax: number;
  discount: number;
  total: number;
  paid: number;
  paymentLines: string[];
  footer: string;
}

/** The PDF's built-in font covers Latin-1 only; fold the rest rather than print garbage. */
function latin(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\xff]/g, "?");
}

const money = (currency: string, n: number) =>
  `${currency} ${Number(n).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function renderInvoicePdf(d: InvoicePdfData): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const L = 48;
  const R = W - 48;
  const green: [number, number, number] = [11, 122, 68];
  const amber: [number, number, number] = [178, 106, 0];
  const red: [number, number, number] = [185, 28, 28];
  const ink: [number, number, number] = [23, 26, 25];
  const soft: [number, number, number] = [91, 98, 93];
  const t = (s: string) => latin(s);

  // Seller, with the mark beside the name.
  const markSize = 30;
  const textLeft = L + markSize + 12;
  try {
    doc.addImage(EDOS_MARK_PNG, "PNG", L, 42, markSize, markSize, undefined, "FAST");
  } catch {
    // An invoice without its logo is still an invoice; one that failed to build is not.
  }
  doc.setFont("helvetica", "bold").setFontSize(18).setTextColor(...ink);
  doc.text(t(d.sellerName), textLeft, 64);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...soft);
  d.sellerLines.forEach((s, i) => doc.text(t(s), textLeft, 80 + i * 12));

  // Title block
  doc.setFont("helvetica", "bold").setFontSize(22).setTextColor(...green);
  doc.text("INVOICE", R, 64, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(...ink);
  doc.text(t(d.number), R, 82, { align: "right" });
  doc.setTextColor(...soft);
  doc.text(t(`Issued ${d.issueDate}`), R, 96, { align: "right" });
  doc.text(t(d.status === "paid" ? (d.paidOn ? `Paid ${d.paidOn}` : "Paid") : `Due ${d.dueDate}`), R, 110, { align: "right" });

  // Billed to
  const top = Math.max(150, 80 + d.sellerLines.length * 12 + 36);
  doc.setDrawColor(226, 230, 226).line(L, top - 16, R, top - 16);
  doc.setFontSize(8).setTextColor(...soft).text("BILLED TO", L, top);
  doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...ink).text(t(d.buyerName), L, top + 16);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...soft);
  d.buyerLines.forEach((s, i) => doc.text(t(s), L, top + 30 + i * 12));

  // The line
  const y = top + 44 + d.buyerLines.length * 12 + 16;
  doc.setFillColor(244, 246, 244).rect(L, y - 14, R - L, 22, "F");
  doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(...soft);
  doc.text("DESCRIPTION", L + 10, y);
  doc.text("AMOUNT", R - 10, y, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(10.5).setTextColor(...ink);
  const lineText = doc.splitTextToSize(t(d.line), R - L - 150) as string[];
  doc.text(lineText, L + 10, y + 28);
  doc.text(t(money(d.currency, d.amount)), R - 10, y + 28, { align: "right" });
  let after = y + 28 + (lineText.length - 1) * 13;
  if (d.detail) {
    doc.setFontSize(9).setTextColor(...soft).text(t(d.detail), L + 10, after + 14);
    after += 14;
  }

  // Totals
  const balance = Math.max(0, d.total - d.paid);
  const rows: [string, string, boolean][] = [];
  if (d.tax > 0) {
    rows.push(["Subtotal", money(d.currency, d.amount), false]);
    rows.push([vatLabel(d.amount, d.tax), money(d.currency, d.tax), false]);
  }
  if (d.discount > 0) rows.push(["Discount", `-${money(d.currency, d.discount)}`, false]);
  rows.push(["Total", money(d.currency, d.total), true]);
  if (d.paid > 0) rows.push(["Paid", money(d.currency, d.paid), false]);
  rows.push(["Balance due", money(d.currency, balance), true]);

  const ty = after + 44;
  doc.setDrawColor(226, 230, 226).line(L, ty - 14, R, ty - 14);
  rows.forEach(([k, v, strong], i) => {
    doc.setFont("helvetica", strong ? "bold" : "normal").setFontSize(strong ? 11.5 : 10).setTextColor(...ink);
    doc.text(t(k), R - 190, ty + i * 18);
    doc.text(t(v), R - 10, ty + i * 18, { align: "right" });
  });

  // Stamp
  const stamp = d.status === "paid" ? green : d.status === "overdue" ? red : amber;
  const label = d.status === "paid" ? "PAID" : d.status === "overdue" ? "OVERDUE" : "DUE";
  doc.setDrawColor(...stamp).setLineWidth(1.5).roundedRect(L, ty - 6, 100, 30, 4, 4, "S");
  doc.setFont("helvetica", "bold").setFontSize(14).setTextColor(...stamp);
  doc.text(label, L + 50, ty + 14, { align: "center" });

  // How to pay, or what was paid
  let py = ty + rows.length * 18 + 40;
  doc.setDrawColor(226, 230, 226).setLineWidth(0.5).line(L, py - 16, R, py - 16);
  doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(...soft);
  doc.text(d.status === "paid" ? "THANK YOU" : "HOW TO PAY", L, py);
  doc.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(...ink);
  const pay = d.status === "paid" ? [`Received in full${d.paidOn ? ` on ${d.paidOn}` : ""}. No further payment is due on this invoice.`] : d.paymentLines;
  for (const p of pay) {
    const wrapped = doc.splitTextToSize(t(p), R - L) as string[];
    doc.text(wrapped, L, py + 16);
    py += wrapped.length * 13;
  }

  doc.setFontSize(8).setTextColor(...soft);
  doc.text(t(d.footer), W / 2, H - 36, { align: "center" });

  return new Uint8Array(doc.output("arraybuffer"));
}
