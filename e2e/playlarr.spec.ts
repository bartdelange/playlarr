import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const password = "long-test-password";
const fixtureImportId = "00000000-0000-4000-8000-000000000001";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL("/");
}

test("first-run setup protects the dashboard", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create password" }).click();
  await expect(page.getByRole("heading", { name: "Playlists" })).toBeVisible();
});

test("login, dashboard, playlist detail, review, revisions, jobs, and settings use the real app", async ({
  page,
}) => {
  await login(page);
  await expect(page.getByText("Fixture Playlist")).toBeVisible();
  await page.getByText("Fixture Playlist").click();
  await expect(
    page.getByRole("heading", { name: "Fixture Playlist" }),
  ).toBeVisible();
  await expect(page.getByText("Fixture Song")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Check source updates" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Generate M3U8" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Import navigation" })
      .getByRole("link", { name: "Local additions" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refresh library files" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Reuse mappings" }),
  ).toBeVisible();
  const importNavigation = page.getByRole("navigation", {
    name: "Import navigation",
  });
  await expect(
    importNavigation.getByRole("link", { name: "Overview" }),
  ).toHaveAttribute("aria-current", "page");
  const workflow = page.getByRole("navigation", { name: "Workflow progress" });
  await expect(workflow.getByText("1 Music match")).toBeVisible();
  await expect(workflow.getByText("2 Lidarr")).toBeVisible();
  await expect(workflow.getByText("3 Final")).toBeVisible();
  await importNavigation.getByRole("link", { name: "History" }).click();
  await expect(
    page.getByRole("heading", { name: "Playlist revisions" }),
  ).toBeVisible();
  await importNavigation.getByRole("link", { name: "Reuse mappings" }).click();
  await expect(
    page.getByRole("heading", { name: "Fixture Playlist" }),
  ).toBeVisible();
  await importNavigation.getByRole("link", { name: "Local additions" }).click();
  await expect(
    page.getByRole("heading", { name: "Playlist additions" }),
  ).toBeVisible();
  await importNavigation.getByRole("link", { name: "Overview" }).click();
  await page.getByRole("link", { name: "Review" }).click();
  await expect(
    page.getByRole("heading", { name: "Fixture Song" }),
  ).toBeVisible();
  await page.goto(`/imports/${fixtureImportId}/revisions`);
  await expect(page.getByText(/0 added/)).toBeVisible();
  await page.goto("/jobs");
  await expect(page.getByText("Fixture Song")).toBeVisible();
  await page.getByRole("link", { name: /playlist update preview/i }).click();
  await page.getByRole("link", { name: "Review source update" }).click();
  await expect(
    page.getByRole("heading", { name: "Fixture Playlist" }),
  ).toBeVisible();
  await expect(page.getByText("1 metadata changes")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Apply approved update" }),
  ).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.locator('input[name="lidarr_api_key"]')).toHaveValue("");
  await expect(
    page.locator('input[name="lidarr_quality_profile_id"]'),
  ).toHaveValue("1");
  await expect(
    page.locator('input[name="lidarr_metadata_profile_id"]'),
  ).toHaveValue("1");
});

test("job progress and logout enforce session state", async ({ page }) => {
  await login(page);
  await page.goto("/jobs");
  await page
    .getByRole("link", { name: /resolution/i })
    .first()
    .click();
  await expect(page.locator("main .job-completed").first()).toHaveText(
    "completed",
  );
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});
