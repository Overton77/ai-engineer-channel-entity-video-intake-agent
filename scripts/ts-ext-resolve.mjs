export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.[a-zA-Z][a-zA-Z0-9]*$/.test(specifier)) {
    for (const extension of [".ts", ".mts", ".js", ".mjs"]) {
      try {
        return await nextResolve(`${specifier}${extension}`, context);
      } catch {
        // Try the next known TypeScript/ESM extension.
      }
    }
  }
  return nextResolve(specifier, context);
}
