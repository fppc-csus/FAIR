import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Upload from "./admin.upload";
import { UPLOAD_TIMEOUT_MS } from "../lib/request";

vi.mock("../adminComponents", () => ({ AdminGuard: ({ children }: { children: React.ReactNode }) => children, AdminNav: () => null }));
vi.mock("../adminAuth", () => ({ adminFetch: async () => Response.json({ data: [] }), getAdminAccessToken: async () => "token", clearAdminSession: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

it.each(["validation", "timeout"])("shows a specific %s failure and retry upload", async kind => {
  let xhr: any;
  class MockRequest {
    upload = {}; timeout = 0; status = 409;
    responseText = JSON.stringify({ error: "A filing for 2026 already exists." });
    onload?: () => void; ontimeout?: () => void;
    constructor() { xhr = this; }
    open() {} setRequestHeader() {} send() {}
  }
  vi.stubGlobal("XMLHttpRequest", MockRequest);
  const { container } = render(<Upload />);
  fireEvent.change(container.querySelector('input[type="file"].sr-only')!, { target: { files: [new File(["workbook"], "filing.xlsx")] } });
  fireEvent.click(screen.getByRole("button", { name: "Upload Form 700" }));
  await waitFor(() => expect(xhr).toBeDefined());
  expect(xhr.timeout).toBe(UPLOAD_TIMEOUT_MS);
  if (kind === "timeout") xhr.ontimeout(); else xhr.onload();
  expect(await screen.findByRole("alert")).toHaveTextContent(kind === "timeout" ? "took too long" : "A filing for 2026 already exists.");
  expect(screen.getByRole("button", { name: "Retry upload" })).toBeEnabled();
  expect(screen.queryByText("Upload complete")).not.toBeInTheDocument();
});