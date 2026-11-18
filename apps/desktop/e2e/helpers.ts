/** Auxiliares dos testes de interface: tudo com o rato, como um utilizador. */
import type { Page } from '@playwright/test';

export async function dragFromLibrary(page: Page, type: string, x: number, y: number) {
  await page.getByTestId(`tile-${type}`).dragTo(page.getByTestId('canvas'), { targetPosition: { x, y } });
}

export async function clickPlace(page: Page, type: string, x: number, y: number) {
  await page.getByTestId(`tile-${type}`).click();
  await page.getByTestId('canvas').click({ position: { x, y } });
}

export async function deviceId(page: Page, type: string) {
  return (await page.locator(`[data-type="${type}"]`).first().getAttribute('data-device'))!;
}

export async function centre(page: Page, sel: string) {
  const b = (await page.locator(sel).first().boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Liga dois terminais arrastando o rato de um para o outro. */
export async function wire(page: Page, a: string, b: string) {
  const pa = await centre(page, `[data-term="${a}"] .term-hit`);
  const pb = await centre(page, `[data-term="${b}"] .term-hit`);
  await page.mouse.move(pa.x, pa.y);
  await page.mouse.down();
  await page.mouse.move((pa.x + pb.x) / 2, (pa.y + pb.y) / 2, { steps: 4 });
  await page.mouse.move(pb.x, pb.y, { steps: 4 });
  await page.mouse.up();
}

export async function clickDevice(page: Page, id: string) {
  await page.locator(`[data-device="${id}"] .hit`).click();
}

export const project = (page: Page) => page.evaluate(() => (window as any).faisca.useApp.getState().project);
