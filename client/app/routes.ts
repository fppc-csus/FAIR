import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("conflicts", "routes/conflicts.tsx"),
  route("about", "routes/about.tsx"),
  route("conflicts/:id", "routes/conflicts.$id.tsx"),
  route("admin/login", "routes/admin.login.tsx"),
  route("admin/upload", "routes/admin.upload.tsx"),
  route("admin/politicians", "routes/admin.politicians.tsx"),
  route("admin/sources", "routes/admin.sources.tsx"),
  route("politicians", "routes/politicians.tsx"),
  route("politicians/:id", "routes/politician-detail.tsx"),
  route("agenda/:id", "routes/agenda-detail.tsx"),
] satisfies RouteConfig;
