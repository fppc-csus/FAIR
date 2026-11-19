import { Link } from "react-router";

export function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="site-container flex flex-col gap-5 py-8 text-sm text-slate-600 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="font-semibold text-slate-900">FAIR — Financial Accountability &amp; Interest Review</p>
          <p className="mt-1 max-w-2xl">Restricted to authorized investigators. Flags are automated candidates for review, not legal determinations under the Political Reform Act.</p>
        </div>
        <nav aria-label="Footer navigation" className="flex flex-wrap gap-x-5 gap-y-2">
          <Link className="hover:text-blue-700" to="/conflicts">Conflicts</Link>
          <Link className="hover:text-blue-700" to="/politicians">Officials</Link>
          <Link className="hover:text-blue-700" to="/about">Methodology</Link>
        </nav>
      </div>
    </footer>
  );
}
