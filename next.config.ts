import createMDX from "@next/mdx";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Load from node_modules at runtime instead of bundling: node-expose-sspi is a native Windows module,
  // DBOS must be ONE instance shared by the startup hook (which launches it) and the server actions,
  // and Playwright (parking report) drives a real browser binary.
  // Run history was renamed Activity.
  redirects: async () => [{ source: "/runs", destination: "/activity", permanent: true }],
  serverExternalPackages: ["node-expose-sspi", "httpntlm", "@dbos-inc/dbos-sdk", "playwright", "exceljs"],
};

// The in-page guides (src/guide/*.mdx) are Markdown files compiled into React components.
// remark-gfm adds tables; given by name so it also works with Turbopack.
export default createMDX({ options: { remarkPlugins: [["remark-gfm"]] } })(nextConfig);
