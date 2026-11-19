import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import App, { UNAUTHENTICATED_PATHS } from "./root";
import { signInForTest } from "./test/session";

function renderAt(path: string) {
  const router = createMemoryRouter([{ path: "/", Component: App, children: [
    { index: true, Component: () => <h1>Dashboard content</h1> },
    { path: "conflicts", Component: () => <h1>Conflict data</h1> },
    { path: "admin/login", Component: () => <h1>Sign in</h1> },
  ] }], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
}

afterEach(() => vi.restoreAllMocks());

describe("investigator-only access", () => {
  it("only the sign-in and account-link pages are reachable without a session", () => {
    expect(UNAUTHENTICATED_PATHS).toEqual(["/admin/login", "/admin/account"]);
  });

  it.each(["/", "/conflicts"])("sends a visitor without a session from %s to sign in", async (path) => {
    renderAt(path);
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByText(/Dashboard content|Conflict data/)).not.toBeInTheDocument();
  });

  it("shows records with the investigator header once the session is verified", async () => {
    signInForTest();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ data: { userId: "u", email: "i@fppc.ca.gov", role: "admin" } }));
    renderAt("/conflicts");
    expect(await screen.findByRole("heading", { name: "Conflict data" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "FAIRInvestigations" })).toHaveTextContent("Investigations");
  });
});
