/** Stub .css imports so Node can load Next app modules under tsx/c8. */
export async function resolve(specifier, context, nextResolve) {
  if (
    specifier.endsWith(".css") ||
    specifier.endsWith(".scss") ||
    (typeof specifier === "string" && specifier.includes(".css"))
  ) {
    return {
      shortCircuit: true,
      url: "data:text/javascript,export default {};",
    };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(".css") || url.endsWith(".scss")) {
    return {
      format: "module",
      shortCircuit: true,
      source: "export default {};",
    };
  }
  return nextLoad(url, context);
}
