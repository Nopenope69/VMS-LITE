import { test, expect, Page } from '@playwright/test';

/**
 * One pass through what a customer does first: log in, finish the first-boot wizard,
 * add a camera, watch it live, then open a recording (via the alert e-mail link
 * format) and play it. A broken player, proxy or recording index fails here.
 */

const PASSWORD = 'E2e-Admin-Pass#2026';

async function token(page: Page): Promise<string> {
  const value = await page.evaluate(() => localStorage.getItem('vms_token'));
  expect(value, 'logged in').toBeTruthy();
  return value!;
}

/** Waits until a <video> in `scope` is decoding frames and its clock moves */
async function expectVideoPlaying(page: Page, scope = 'body') {
  try {
    await pollVideoPlaying(page, scope);
  } catch (err) {
    // Say why: the media element's own state and what the console shows
    const state = await page.evaluate((sel) => {
      const videos = Array.from(document.querySelectorAll<HTMLVideoElement>(`${sel} video`)).map((v) => ({
        src: (v.currentSrc || (v.srcObject ? 'webrtc' : '')).slice(0, 160),
        readyState: v.readyState,
        networkState: v.networkState,
        paused: v.paused,
        currentTime: v.currentTime,
        videoWidth: v.videoWidth,
        error: v.error ? `${v.error.code} ${v.error.message}` : null,
      }));
      const text = document.body.innerText.replace(/\s+/g, ' ').slice(0, 600);
      return { videos, text };
    }, scope);
    throw new Error(`${(err as Error).message}\nPlayer state: ${JSON.stringify(state, null, 2)}`);
  }
}

async function pollVideoPlaying(page: Page, scope: string) {
  await expect
    .poll(
      async () =>
        page.evaluate(async (sel) => {
          const videos = Array.from(document.querySelectorAll<HTMLVideoElement>(`${sel} video`));
          const before = videos.map((v) => v.currentTime);
          await new Promise((r) => setTimeout(r, 1500));
          return videos.some((v, i) => v.videoWidth > 0 && v.currentTime > before[i]);
        }, scope),
      { timeout: 45_000, intervals: [1000] }
    )
    .toBe(true);
}

test('first boot, live view and recorded playback', async ({ page, request }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  // 1. First login with the factory password, then the first-boot wizard
  await page.goto('/');
  await page.fill('input[type="text"]', 'admin');
  await page.fill('input[type="password"]', 'admin123');
  await page.click('button[type="submit"]');
  await page.getByPlaceholder('e.g. Warehouse North Gate').fill('Head Office');
  await page.getByPlaceholder('Min. 8 characters').fill(PASSWORD);
  await page.getByPlaceholder('Re-enter new password').fill(PASSWORD);
  const factoryToken = await token(page);
  const setupDone = page.waitForResponse((r) => r.url().includes('/api/system/setup-complete'));
  await page.getByRole('button', { name: /Complete Initial Provisioning/ }).click();
  expect((await setupDone).status()).toBe(200);
  // The password change revokes the factory session; the console switches to a new token
  await expect.poll(() => token(page), { timeout: 15_000 }).not.toBe(factoryToken);
  await expect(page.getByRole('button', { name: /^Live/ }).first()).toBeVisible();

  // 2. Add the simulated camera, always with the token the console currently holds
  const auth = async () => ({ Authorization: `Bearer ${await token(page)}` });
  const created = await request.post('/api/cameras', {
    headers: await auth(),
    data: { name: 'E2E Cam', rtspUrl: 'rtsp://127.0.0.1:18554/cam' },
  });
  expect(created.status(), await created.text()).toBe(201);
  const camera = await created.json();

  // 3. Live view (WebRTC through the authenticated media proxy)
  await page.reload();
  await page.getByRole('button', { name: /^Live/ }).first().click();
  await expectVideoPlaying(page);

  // 4. Wait for a completed recording segment on the timeline
  let span: { startTime: string; endTime: string } | undefined;
  await expect
    .poll(
      async () => {
        const day = new Date().toISOString().slice(0, 10);
        const res = await request.get(`/api/playback/timeline?cameraId=${camera.id}&date=${day}`, {
          headers: await auth(),
        });
        expect(res.status(), 'timeline request').toBe(200);
        const spans = res.ok() ? (await res.json()).spans ?? [] : [];
        span = spans.find((s: any) => Date.parse(s.endTime) - Date.parse(s.startTime) >= 8_000);
        return Boolean(span);
      },
      { timeout: 90_000, intervals: [3000] }
    )
    .toBe(true);

  // 5. Open the recording the way an alert e-mail links to it, and play it
  const at = new Date(Date.parse(span!.startTime) + 2_000).toISOString();
  await page.goto(`/playback?cameraId=${camera.id}&t=${encodeURIComponent(at)}`);
  await expect(page).toHaveURL(/\/$/); // the link is consumed
  const recording = page.waitForResponse((r) => r.url().includes('/api/media/playback/get'));
  await page.getByTitle('Play Footage (Space)').click();
  const response = await recording;
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('video/mp4');
  expect(new URL(response.url()).searchParams.get('start')).toBe(at); // opened at the linked moment
  if (process.env.E2E_PLAYBACK_DECODE !== '0') {
    await expectVideoPlaying(page);
  }

  expect(pageErrors, 'no uncaught errors in the page').toEqual([]);
});
