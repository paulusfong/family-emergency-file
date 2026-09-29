/**
 * Lightweight Next.js harness for node:test + mock.module.
 * Call installNextMocks() before importing app modules that touch next/*.
 */
import { mock } from "node:test";
import React from "react";

export class NextRedirect extends Error {
  digest: string;
  constructor(public url: string) {
    super(`NEXT_REDIRECT:${url}`);
    this.digest = `NEXT_REDIRECT;replace;${url};303`;
  }
}

export class NextNotFound extends Error {
  digest = "NEXT_NOT_FOUND";
  constructor() {
    super("NEXT_NOT_FOUND");
  }
}

type CookieStore = {
  get: (name: string) => { value: string } | undefined;
  set: (...args: unknown[]) => void;
};

let cookieMap = new Map<string, string>();
let headerStore = new Headers();

/** Paths passed to next/cache revalidatePath since the last resetHarness(). */
export const revalidated: string[] = [];

export function resetHarness() {
  cookieMap = new Map();
  headerStore = new Headers();
  revalidated.length = 0;
}

export function setCookie(name: string, value: string) {
  cookieMap.set(name, value);
}

export function setHeaders(init?: HeadersInit) {
  headerStore = new Headers(init);
}

const cookieStore: CookieStore = {
  get(name) {
    const v = cookieMap.get(name);
    return v === undefined ? undefined : { value: v };
  },
  set(name: unknown, value?: unknown) {
    if (typeof name === "string") {
      cookieMap.set(name, String(value ?? ""));
    }
  },
};

export function installNextMocks() {
  mock.module("next/navigation", {
    namedExports: {
      redirect: (url: string) => {
        throw new NextRedirect(url);
      },
      notFound: () => {
        throw new NextNotFound();
      },
      useRouter: () => ({}),
      usePathname: () => "/",
      useSearchParams: () => new URLSearchParams(),
    },
  });

  mock.module("next/headers", {
    namedExports: {
      cookies: async () => cookieStore,
      headers: async () => headerStore,
    },
  });

  mock.module("next/cache", {
    namedExports: {
      revalidatePath: (p: string) => {
        revalidated.push(p);
      },
      revalidateTag: () => {},
    },
  });

  mock.module("next/link", {
    defaultExport: function Link({
      children,
      href,
      ...rest
    }: {
      children?: React.ReactNode;
      href: string;
      [k: string]: unknown;
    }) {
      return React.createElement("a", { href, ...rest }, children);
    },
  });

  mock.module("next/font/google", {
    namedExports: {
      Source_Sans_3: () => ({ variable: "--font-sans", className: "sans" }),
    },
  });
}

export async function renderElement(node: React.ReactNode): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  return renderToStaticMarkup(node as React.ReactElement);
}
