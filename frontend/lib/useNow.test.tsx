import { act, render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useNow } from "./useNow";

function Clock({ testId }: { testId: string }) {
  const now = useNow();
  return <span data-testid={testId}>{now}</span>;
}

describe("useNow", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  test("re-renders with an updated timestamp after 1s of fake time passes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);

    render(<Clock testId="clock" />);
    expect(screen.getByTestId("clock").textContent).toBe("1000000");

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByTestId("clock").textContent).toBe("1001000");
  });

  test("two mounted consumers share the same tick", () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);

    render(
      <>
        <Clock testId="a" />
        <Clock testId="b" />
      </>,
    );

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    const a = screen.getByTestId("a").textContent;
    const b = screen.getByTestId("b").textContent;
    expect(a).toBe(b);
    expect(a).toBe("2001000");
  });
});
