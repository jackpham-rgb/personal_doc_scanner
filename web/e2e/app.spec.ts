import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { DESK_PHOTO, PHOTO } from './fixtures';

// Reading text runs Tesseract in the browser; give it time on slow machines.
const OCR_TIMEOUT = 90_000;

async function scanWithCamera(page: Page) {
  await page.getByRole('button', { name: 'Scan' }).click();
  // The simulated camera shows a receipt; it is found and captured by itself.
  await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
}

async function waitUntilFiled(page: Page, title: string) {
  await expect(page.getByText(`Saved “${title}”`)).toBeVisible({ timeout: OCR_TIMEOUT });
}

test('scan with the camera: captured, read, named, filed and searchable', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByText('No documents yet')).toBeVisible();

  await scanWithCamera(page);
  const review = page.getByAltText('Scanned page 1');
  await expect(review).toBeVisible();
  // Straightened: the receipt is taller than wide, like the paper.
  const size = await review.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]);
  expect(size[1] / size[0]).toBeGreaterThan(1.2);

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Reading text|Starting/ })).toBeVisible();
  await waitUntilFiled(page, 'Costco Receipt Nov 2026');
  await expect(page.getByText('Receipts · Nov 5, 2026 · $124.53')).toBeVisible();

  // Found by a word that appears only inside the document.
  const search = page.getByPlaceholder('Search inside your documents');
  await search.fill('towel');
  await expect(page.getByText(/PAPER TOWEL/)).toBeVisible();
  await search.fill('mortgage');
  await expect(page.getByText('No documents match')).toBeVisible();
  await search.fill('costco');

  // The document page and its searchable PDF.
  await page.getByRole('link', { name: /^Costco Receipt Nov 2026/ }).click();
  await expect(page.getByRole('heading', { name: 'Costco Receipt Nov 2026' })).toBeVisible();
  await expect(page.getByText('$124.53')).toBeVisible();
  const downloading = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('Costco Receipt Nov 2026.pdf');
  const pdf = readFileSync(await download.path());
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');

  // It survives a reload: the library is stored on the device.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Costco Receipt Nov 2026' })).toBeVisible();
});

test('rename, re-file and delete', async ({ page }) => {
  await page.goto('./');
  await scanWithCamera(page);
  await page.getByRole('button', { name: 'Save' }).click();
  await waitUntilFiled(page, 'Costco Receipt Nov 2026');
  await page.getByRole('link', { name: /^Costco Receipt Nov 2026/ }).click();

  page.once('dialog', (d) => d.accept('Groceries: November?'));
  await page.getByRole('button', { name: 'Rename' }).click();
  await expect(page.getByRole('heading', { name: 'Groceries November' })).toBeVisible();

  await page.getByLabel('Folder').selectOption({ label: 'Taxes' });
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByText(/^Taxes · /)).toBeVisible();

  await page.getByRole('link', { name: /^Groceries November/ }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('No documents yet')).toBeVisible();
});

test('two pages, one document', async ({ page }) => {
  await page.goto('./');
  await scanWithCamera(page);
  await page.getByRole('button', { name: 'Add page' }).click();
  // The same page is still in view; it is not captured twice by itself.
  await page.waitForTimeout(2500);
  await expect(page.getByRole('button', { name: 'Save' })).toBeHidden();
  await page.getByRole('button', { name: 'Capture' }).click();
  await expect(page.getByText('Page 2 of 2')).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();
  await waitUntilFiled(page, 'Costco Receipt Nov 2026');
  await page.getByRole('link', { name: /^Costco Receipt Nov 2026/ }).click();
  await expect(page.getByText('2 pages — swipe to see them')).toBeVisible();
});

test('import photos instead of using the camera', async ({ page }) => {
  await page.goto('./#/scan');
  await page.locator('input[type=file]').setInputFiles([PHOTO, DESK_PHOTO]);
  await expect(page.getByText('Page 2 of 2')).toBeVisible();
  // The receipt photo was cropped to the paper; the empty desk photo is kept
  // whole because there is no page in it.
  await page.getByRole('button', { name: 'Page 1' }).click();
  const [w, h] = await page
    .getByAltText('Scanned page 1')
    .evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]);
  expect(h / w).toBeGreaterThan(1.2);
});

test('adjust the corners by hand', async ({ page }) => {
  await page.goto('./');
  await scanWithCamera(page);
  const before = await page
    .getByAltText('Scanned page 1')
    .evaluate((img: HTMLImageElement) => img.naturalWidth);
  await page.getByRole('button', { name: 'Corners' }).click();
  await expect(page.getByText('Drag the corners')).toBeVisible();

  // Drag the top-right and bottom-right handles to the middle of the photo.
  for (const corner of [1, 2]) {
    const handle = page.locator(`circle[data-corner="${corner}"]`);
    const box = (await handle.boundingBox())!;
    const area = (await page.locator('.adjust-area').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(area.x + area.width * 0.5, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
  }
  await page.getByRole('button', { name: 'Done' }).click();
  const after = await page
    .getByAltText('Scanned page 1')
    .evaluate((img: HTMLImageElement) => img.naturalWidth);
  expect(after).toBeLessThan(before * 0.8);
});

test('settings explain how to connect Google Drive', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByText('Capture automatically')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect Google Drive' })).toBeDisabled();
  await expect(page.locator('code')).toHaveText('http://localhost:4173');
  await page.getByLabel('OAuth client ID').fill('123-abc.apps.googleusercontent.com');
  await expect(page.getByRole('button', { name: 'Connect Google Drive' })).toBeEnabled();
});

test('installable as an app that works offline', async ({ page }) => {
  await page.goto('./');
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector<HTMLLinkElement>('link[rel=manifest]')!;
    return (await fetch(link.href)).json();
  });
  expect(manifest).toMatchObject({ name: 'Doc Scanner', display: 'standalone' });
  await expect
    .poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.active))
    .toBe(true);
});
