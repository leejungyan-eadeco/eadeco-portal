import type { MDXComponents } from "mdx/types";

// Required by @next/mdx. The guides are styled with the typography plugin (see guide.tsx), so nothing to override.
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return components;
}
