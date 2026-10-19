import type { NextConfig } from "next";

const supabaseOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://sedsjjmjnikppfaecaya.supabase.co").origin;
const supabaseWsOrigin = supabaseOrigin.replace(/^https:/, "wss:");
const isDev = process.env.NODE_ENV !== "production";

// Google Analytics (GA4) is allowed in the CSP unconditionally so it works the moment
// an admin sets a real ga_measurement_id in Site Settings — GoogleAnalytics.tsx only
// injects the script when that ID is actually configured, so this allowance is inert
// (no tracking, no request to Google) until then.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://www.googletagmanager.com${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${supabaseOrigin} https://www.google-analytics.com`,
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseOrigin} ${supabaseWsOrigin} https://www.google-analytics.com https://region1.google-analytics.com`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const pdfHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "sedsjjmjnikppfaecaya.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "framer-motion"],
  },
  async headers() {
    return [
      // Everything except the admin invoice PDF keeps the strict headers.
      { source: "/((?!api/admin/invoices/[^/]+/pdf).*)", headers: securityHeaders },
      // The invoice PDF is shown in a window inside the admin (InvoiceViewer),
      // so it may be framed — by this site only — and carries no object-src
      // rule, which would stop the browser's PDF viewer from drawing it. It is
      // admin-only and a PDF, so there is no page script to protect.
      { source: "/api/admin/invoices/:id/pdf", headers: pdfHeaders },
    ];
  },
};

export default nextConfig;
