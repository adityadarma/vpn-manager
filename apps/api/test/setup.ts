// Vitest global setup — runs before test files are imported.
// The DB seed reads ADMIN_PASSWORD to set the initial admin password;
// pin it to a known value so login helpers in tests are deterministic.
process.env.ADMIN_PASSWORD = 'Admin@1234!'
