export function getClientOrigin({
  clientOrigin = process.env.CLIENT_ORIGIN,
  nodeEnv = process.env.NODE_ENV,
} = {}) {
  return clientOrigin || (nodeEnv === 'production' ? false : 'http://localhost:5173');
}
