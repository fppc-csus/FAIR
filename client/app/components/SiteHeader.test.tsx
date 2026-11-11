import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { SiteHeader } from "./SiteHeader";
import { TIMEOUT_MESSAGE } from "../lib/request";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
it("keeps the full brand and search available alongside collapsible navigation", () => {
  render(<MemoryRouter><SiteHeader /></MemoryRouter>);
  const home = screen.getByRole("link", { name: "FAIRPublic records review" });
  expect(home).toHaveTextContent("FAIR");
  expect(home).toHaveTextContent("Public records review");
  expect(screen.getByRole("searchbox", { name: "Search FAIR records" })).toBeInTheDocument();
  const toggle = screen.getByRole("button", { name: "Toggle navigation" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(toggle).toHaveAttribute("aria-controls", "mobile-navigation");
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("navigation", { name: "Mobile navigation" })).toHaveTextContent("About");
  fireEvent.keyDown(toggle, { key: "Escape" });
  expect(screen.queryByRole("navigation", { name: "Mobile navigation" })).not.toBeInTheDocument();
});
it("opens mobile navigation and retries a timed-out search", async () => {
  vi.useFakeTimers();
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => {}));
  render(<MemoryRouter><SiteHeader /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Toggle navigation" }));
  expect(screen.getByRole("navigation", { name: "Mobile navigation" })).toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Jordan" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(20_300); });
  expect(screen.getByRole("alert")).toHaveTextContent(TIMEOUT_MESSAGE);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(fetch).toHaveBeenCalledTimes(2);
});
