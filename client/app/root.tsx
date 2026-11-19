import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
  Navigate,
} from "react-router";
import { Toaster } from "react-hot-toast";

import type { Route } from "./+types/root";
import "./app.css";
import { SiteHeader } from "./components/SiteHeader";
import { SiteFooter } from "./components/SiteFooter";
import NotFound from "./components/NotFound";
import { AdminGuard } from "./adminComponents";

/** The only pages reachable without an investigator session. */
export const UNAUTHENTICATED_PATHS = ["/admin/login", "/admin/account"];

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <Toaster position="top-right" />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const location = useLocation();
  const isAdminRoute = location.pathname.startsWith("/admin");
  if (UNAUTHENTICATED_PATHS.includes(location.pathname)) return <Outlet />;
  // Admin routes render their own guard and navigation.
  if (isAdminRoute) return <div id="main-content"><Outlet /></div>;

  // FAIR is an internal investigation tool: every other page requires sign-in.
  return (
    <AdminGuard>
      <SiteHeader />
      <main id="main-content" tabIndex={-1}>
        <Outlet />
      </main>
      <SiteFooter />
    </AdminGuard>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  if ((isRouteErrorResponse(error) || error instanceof Response) && error.status === 404) return <NotFound />;
  if (isRouteErrorResponse(error) && [401, 403].includes(error.status)) return <Navigate to="/admin/login?reason=forbidden" replace />;
  let message = "Oops!";
  let details = "An unexpected error occurred.";


  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : details;

  }

  return (
    <main className="page-shell">
      <section className="surface mx-auto max-w-2xl p-8 text-center sm:p-12">
      <p className="eyebrow">FAIR</p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight">{message}</h1>
      <p className="mt-3 text-slate-600">{details}</p>
      <button className="button-secondary mt-6" onClick={() => window.location.reload()}>Retry</button>
      <a href="/" className="button-primary mt-6 ml-3">Return to dashboard</a>
      </section>
    </main>
  );
}
