/** Seed a valid investigator session so authenticated data hooks run in tests. */
export function signInForTest() {
  window.localStorage.setItem("fair.admin.session", JSON.stringify({
    access_token: "test-access", refresh_token: "test-refresh", expires_in: 3600, expires_at: Date.now() + 3_600_000,
  }));
}
