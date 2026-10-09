import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Navigate, useLocation } from "react-router";
import { Database, FileUp, LogOut, ShieldCheck, UsersRound } from "lucide-react";
import { getAdminSession, signOut } from "./adminAuth";

export function AdminGuard({ children }: { children: ReactNode }) {
  const [authorized, setAuthorized] = useState<boolean | null>(null); const location = useLocation();
  useEffect(() => { let active = true; getAdminSession().then(() => { if (active) setAuthorized(true); }).catch(() => { if (active) setAuthorized(false); }); return () => { active = false; }; }, []);
  if (authorized === null) return <main className="grid min-h-screen place-items-center bg-slate-100"><div className="surface p-6 text-sm text-slate-600" role="status">Checking admin session…</div></main>;
  if (!authorized) return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

const links = [{ to: "/admin/upload", label: "Upload", Icon: FileUp }, { to: "/admin/politicians", label: "Officials", Icon: UsersRound }, { to: "/admin/sources", label: "Sources", Icon: Database }];
export function AdminNav({ title }: { title: string }) {
  async function handleSignOut() { await signOut(); window.location.assign("/admin/login"); }
  return <header className="border-b border-slate-200 bg-white"><div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8"><div className="flex min-h-20 flex-wrap items-center justify-between gap-4 py-3"><div className="flex items-center gap-3"><Link to="/admin/sources" className="grid h-10 w-10 place-items-center rounded-lg bg-slate-950 text-white" aria-label="FAIR admin home"><ShieldCheck size={21} /></Link><div><p className="text-xs font-bold uppercase tracking-wider text-blue-700">FAIR Admin</p><h1 className="mt-0.5 text-lg font-semibold text-slate-950">{title}</h1></div></div><div className="flex flex-wrap items-center gap-1"><nav className="flex items-center gap-1" aria-label="Admin navigation">{links.map(({ to, label, Icon }) => <NavLink key={to} to={to} className={({ isActive }) => `inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${isActive ? "bg-blue-50 text-blue-800" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"}`}><Icon size={16} /> <span className="hidden sm:inline">{label}</span></NavLink>)}</nav><span className="mx-1 h-6 w-px bg-slate-200" /><button className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-950" onClick={handleSignOut} type="button"><LogOut size={16} /><span className="hidden sm:inline">Sign out</span></button></div></div></div></header>;
}