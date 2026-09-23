import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";

afterEach(() => {
  cleanup();
});

// jsdom shims for Headless UI 2.x (design-system R16): its Floating UI-based
// anchoring and transitions expect ResizeObserver and
// Element.prototype.getAnimations, neither of which jsdom implements.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (typeof Element !== "undefined" && !("getAnimations" in Element.prototype)) {
  // @ts-expect-error -- jsdom does not implement the Web Animations API.
  Element.prototype.getAnimations = () => [];
}
