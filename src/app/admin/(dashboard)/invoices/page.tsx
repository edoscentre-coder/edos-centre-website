import { getInvoices, getPayments, getClients, getWebsites, getSubscriptions, getMpesaTransactions } from "@/lib/admin/queries";
import InvoicesManager from "@/components/admin/billing/InvoicesManager";
import { getBillingSettings } from "@/lib/admin/billing-settings";

export const metadata = { title: "Invoices — EDOS Control Centre" };

export default async function InvoicesPage() {
  const [invoices, payments, clients, websites, subscriptions, mpesaTransactions, billing] = await Promise.all([
    getInvoices(),
    getPayments(),
    getClients(),
    getWebsites(),
    getSubscriptions(),
    getMpesaTransactions(),
    getBillingSettings(),
  ]);
  return (
    <InvoicesManager
      invoices={invoices}
      payments={payments}
      clients={clients}
      websites={websites}
      subscriptions={subscriptions}
      mpesaTransactions={mpesaTransactions}
      vat={{ enabled: billing.vatReady && billing.vat_enabled, rate: Number(billing.vat_rate) }}
    />
  );
}
