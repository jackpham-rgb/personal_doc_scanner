import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '.fixtures');
/** What the simulated camera sees: a receipt lying on a desk, at an angle. */
export const CAMERA_FEED = join(FIXTURES, 'camera.mjpeg');
/** The same scene as a photo, for importing from files. */
export const PHOTO = join(FIXTURES, 'photo.jpg');
/** A photo with no document in it. */
export const DESK_PHOTO = join(FIXTURES, 'desk.jpg');

const RECEIPT = [
  'COSTCO WHOLESALE',
  'Richmond #482',
  '',
  'KS PAPER TOWEL      21.99',
  'ROTISSERIE CHICKEN   4.99',
  'ORGANIC EGGS         7.49',
  'SUBTOTAL           114.25',
  'TAX                 10.28',
  'TOTAL              124.53',
  'VISA               124.53',
  'CHANGE DUE           0.00',
  '',
  '11/05/2026 17:42',
  'THANK YOU',
].join('\n');

const scene = (withPaper: boolean) => `
  <body style="margin:0;width:1920px;height:1080px;overflow:hidden;
               background:repeating-linear-gradient(100deg,#4a3526 0 38px,#56402e 38px 80px)">
    ${
      withPaper
        ? `<pre style="position:absolute;left:640px;top:70px;width:620px;height:880px;margin:0;
                       box-sizing:border-box;padding:56px 44px;background:#f6f4ee;color:#151515;
                       font:bold 30px/1.75 monospace;
                       transform:perspective(2600px) rotateX(16deg) rotateZ(-5deg)">${RECEIPT}</pre>`
        : ''
    }
  </body>`;

/**
 * Renders the test scenes with the browser itself, so the tests need no
 * image tooling and no binary files in the repository.
 */
export default async function makeFixtures(): Promise<void> {
  mkdirSync(FIXTURES, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const shoot = async (withPaper: boolean) => {
      await page.setContent(scene(withPaper));
      return page.screenshot({ type: 'jpeg', quality: 92 });
    };
    const withPaper = await shoot(true);
    // A Motion-JPEG file is JPEG frames end to end; one frame loops as a
    // still picture.
    writeFileSync(CAMERA_FEED, withPaper);
    writeFileSync(PHOTO, withPaper);
    writeFileSync(DESK_PHOTO, await shoot(false));
  } finally {
    await browser.close();
  }
}
