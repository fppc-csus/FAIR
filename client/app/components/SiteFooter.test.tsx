import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, it } from "vitest";
import { SiteFooter } from "./SiteFooter";

it("states the restricted, non-legal-finding nature of FAIR and links the investigator pages", () => {
  render(<MemoryRouter><SiteFooter /></MemoryRouter>);
  const footer = screen.getByRole("contentinfo");
  expect(footer).toHaveTextContent("Financial Accountability & Interest Review");
  expect(footer).toHaveTextContent("Restricted to authorized investigators");
  expect(footer).toHaveTextContent("not legal determinations");
  for (const [name, href] of [["Conflicts", "/conflicts"], ["Officials", "/politicians"], ["Methodology", "/about"]]) {
    expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
  }
  expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
});
