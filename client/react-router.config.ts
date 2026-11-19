import type { Config } from "@react-router/dev/config";

export default {
  // SPA mode: FAIR is a login-only app whose pages load data in the browser
  // after sign-in, so it builds to static files (build/client) that AWS
  // Amplify Hosting serves behind Cloudflare. See amplify.yml at the repo root.
  ssr: false,
} satisfies Config;
