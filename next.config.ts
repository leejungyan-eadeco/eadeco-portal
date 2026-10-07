import createMDX from "@next/mdx";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Load from node_modules at runtime instead of bundling: node-expose-sspi is a native Windows module,
  // and DBOS must be ONE instance shared by the startup hook (which launches it) and the server actions.
  serverExternalPackages: ["node-expose-sspi", "@dbos-inc/dbos-sdk"],
};

// The in-page guides (src/guide/*.mdx) are Markdown files compiled into React components.
// remark-gfm adds tables; given by name so it also works with Turbopack.
export default createMDX({ options: { remarkPlugins: [["remark-gfm"]] } })(nextConfig);
