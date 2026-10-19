"use client";

import { useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Download, Printer, X } from "lucide-react";

/**
 * An invoice in a window over the admin, rather than in a new tab: the PDF the
 * client receives, with Print and Download beside it. Closing it leaves the
 * admin exactly where it was.
 */
export function InvoiceViewer({
  invoiceId,
  invoiceNumber,
  onClose,
}: {
  invoiceId: string | null;
  invoiceNumber?: string | null;
  onClose: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const src = invoiceId ? `/api/admin/invoices/${invoiceId}/pdf` : "";

  return (
    <Dialog.Root open={Boolean(invoiceId)} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 flex h-[92vh] w-[96vw] max-w-4xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl focus:outline-none"
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
            <Dialog.Title className="font-mono text-sm font-semibold text-slate-900">{invoiceNumber ?? "Invoice"}</Dialog.Title>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => frame.current?.contentWindow?.print()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Printer className="h-3.5 w-3.5" /> Print
              </button>
              <a
                href={`${src}?download=1`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Download className="h-3.5 w-3.5" /> Download PDF
              </a>
              <Dialog.Close className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
                <X className="h-5 w-5" />
              </Dialog.Close>
            </div>
          </div>
          {src && <iframe ref={frame} src={src} title={invoiceNumber ?? "Invoice"} className="h-full w-full flex-1 bg-slate-100" />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
