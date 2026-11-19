export function clientLoader() {
  throw new Response(null, { status: 404, statusText: 'Not Found' });
}

export default function NotFoundRoute() {
  return null;
}