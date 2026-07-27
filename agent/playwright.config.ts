import { defineConfig } from '@playwright/test';
export default defineConfig({
  use: {
    actionTimeout: 30000,
    navigationTimeout: 60000,
    baseURL: "http://mtpc_test",
    storageState: "/workspace/agent/auth-profile/state.json",
  },
  timeout: 60000,
});
