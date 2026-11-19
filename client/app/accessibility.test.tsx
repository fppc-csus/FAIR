import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { MemoryRouter, Route, Routes } from "react-router";
import { expect, it } from "vitest";
import App from "./root";

it("has no automated accessibility violations in the shared public layout", async () => {
  const { container } = render(
    <MemoryRouter>
      <Routes>
        <Route element={<App />}>
          <Route index element={<section aria-label="Page content"><h1>Overview</h1><p>Public records review.</p></section>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

  expect((await axe(container, {
    rules: { "color-contrast": { enabled: false } },
  })).violations).toEqual([]);
});
