import type { APIRequestContext, Page } from "@playwright/test";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
export const SUPERADMIN_EMAIL = "superadmin@bmp.local";
export const SUPERADMIN_PASSWORD = "ChangeMe123!";

export async function login(page: Page, email = SUPERADMIN_EMAIL, password = SUPERADMIN_PASSWORD): Promise<void> {
  await page.goto("/login");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard", { timeout: 15_000 });
}

/** Logs in against the API directly (no browser) for seeding fixture data. */
export async function apiLogin(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/auth/login`, {
    data: { email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASSWORD },
  });
  const body = await response.json();
  return body.data.accessToken as string;
}
