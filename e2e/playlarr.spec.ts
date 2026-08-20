import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const password = "long-test-password";
const fixtureImportId = "00000000-0000-4000-8000-000000000001";
const reviewImportId = "00000000-0000-4000-8000-000000000002";

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
  await page.screenshot({
    path: "docs/images/migration-output/dashboard.png",
    fullPage: true,
  });
  await page.getByText("Fixture Playlist").click();
  await expect(
    page.getByRole("heading", { name: "Fixture Playlist" }),
  ).toBeVisible();
  await expect(page.getByText("Fixture Song")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refresh playlist" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Delete import" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Import navigation" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Reuse mappings" }),
  ).toBeVisible();
  const workflow = page.getByRole("navigation", { name: "Workflow progress" });
  await expect(workflow.getByText("1 Music match")).toBeVisible();
  await expect(workflow.getByText("2 Lidarr")).toBeVisible();
  await expect(workflow.getByText("3 Final")).toBeVisible();
  await expect(page.getByRole("button", { name: /All \(/ })).toBeVisible();
  await expect(page.getByText("Choose visible columns")).toBeVisible();
  await workflow.getByRole("link", { name: "2 Lidarr" }).click();
  await expect(page.getByText("What do the plan actions do?")).toBeVisible();
  await workflow.getByRole("link", { name: "3 Final" }).click();
  await expect(
    page.getByRole("button", { name: "Refresh monitored & downloaded" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Export M3U" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Downloaded \(/ }),
  ).toBeVisible();
  await expect(page.getByText("No matched Lidarr track")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Local additions" }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/images/migration-output/final.png",
    fullPage: true,
  });
  await page.getByText(/Playlist refresh history/).click();
  await page.locator("details.history").getByRole("link").first().click();
  await expect(
    page.getByRole("heading", { name: "Playlist revision" }),
  ).toBeVisible();
  await page.goto(`/imports/${fixtureImportId}`);
  await page.getByRole("link", { name: "Reuse mappings" }).click();
  await expect(
    page.getByRole("heading", { name: "Fixture Playlist" }),
  ).toBeVisible();
  await page.goto(`/imports/${fixtureImportId}?stage=final`);
  await page.getByRole("link", { name: "Local additions" }).click();
  await expect(
    page.getByRole("heading", { name: "Playlist additions" }),
  ).toBeVisible();
  await page.goto(`/imports/${fixtureImportId}`);
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
  await page.screenshot({
    path: "docs/images/migration-output/settings-services.png",
    fullPage: true,
  });
  await expect(page.getByText("Services", { exact: true })).toBeVisible();
  await page.getByText("Data Settings", { exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Playlist paths" }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/images/migration-output/settings-data.png",
    fullPage: true,
  });
  await page.goto("/imports/new");
  await expect(
    page.getByRole("heading", { name: "Choose a source" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Choose Spotify" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Choose TIDAL" }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/images/migration-output/new-import.png",
    fullPage: true,
  });
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

test("manual review session exposes navigation and advances after a decision", async ({
  page,
}) => {
  await login(page);
  await page.goto(`/imports/${reviewImportId}?stage=match`);
  await page.getByRole("link", { name: "Review 2 tracks" }).click();
  await expect(page).toHaveURL(/\/entries\/\d+\/review\?session=true$/);
  await expect(page.getByText("Track 1 of 2")).toBeVisible();
  await expect(page.getByRole("link", { name: "Next" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Exit session" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Validate MBID" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Search" })).toBeVisible();
  await page.getByRole("button", { name: "Skip track and continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Review Second" }),
  ).toBeVisible();
  await expect(page.getByText("Track 1 of 1")).toBeVisible();
  await expect(page.getByRole("link", { name: "Previous" })).toHaveCount(0);
});
