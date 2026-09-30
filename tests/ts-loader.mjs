import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// API TypeScript uses .js specifiers for Vercel/ESM builds. Resolve those to
// source .ts files when Node's built-in TypeScript test runner reads them.
export async function resolve(specifier, context, nextResolve) {
  if (
    context.parentURL &&
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    specifier.endsWith(".js")
  ) {
    const source = new URL(specifier, context.parentURL);
    source.pathname = source.pathname.replace(/\.js$/, ".ts");
    if (existsSync(fileURLToPath(source))) return nextResolve(source.href, context);
  }
  return nextResolve(specifier, context);
}
