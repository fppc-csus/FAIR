import { Link } from "react-router";

export function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-8 text-sm text-slate-600 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
        <div>
          <p className="font-semibold text-slate-900">FAIR</p>
          <p className="mt-1">Financial Accountability &amp; Interest Review</p>
        </div>
        <nav aria-label="Footer navigation" className="flex flex-wrap gap-x-5 gap-y-2">
          <Link className="hover:text-blue-700" to="/conflicts">Conflict flags</Link>
          <Link className="hover:text-blue-700" to="/politicians">Public officials</Link>
          <Link className="hover:text-blue-700" to="/about">About</Link>
          <Link className="hover:text-blue-700" to="/admin/login">Admin</Link>
        </nav>
      </div>
    </footer>
  );
}