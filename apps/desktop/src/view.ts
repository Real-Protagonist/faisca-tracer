/** Zoom e enquadramento da área de trabalho. */
import { bbox } from './editor/geometry';
import { registry, ui, useApp } from './store';

const canvasSize = () => {
  const el = document.querySelector('[data-testid="canvas"]') as SVGSVGElement | null;
  const r = el?.getBoundingClientRect();
  return { w: r?.width ?? 1000, h: r?.height ?? 600 };
};

export function zoomBy(f: number) {
  const { view } = useApp.getState();
  const { w, h } = canvasSize();
  const zoom = Math.min(3, Math.max(0.25, view.zoom * f));
  ui.setView({ zoom, x: w / 2 - ((w / 2 - view.x) * zoom) / view.zoom, y: h / 2 - ((h / 2 - view.y) * zoom) / view.zoom });
}

/** Mostra todos os aparelhos. */
export function fitView(maxZoom = 1.5) {
  const { project } = useApp.getState();
  const { w, h } = canvasSize();
  if (!project.devices.length) return ui.setView({ x: 40, y: 40, zoom: 1 });
  const bs = project.devices.map((d) => bbox(registry, d));
  const x0 = Math.min(...bs.map((b) => b.x)) - 40;
  const y0 = Math.min(...bs.map((b) => b.y)) - 40;
  const x1 = Math.max(...bs.map((b) => b.x + b.w)) + 60;
  const y1 = Math.max(...bs.map((b) => b.y + b.h)) + 40;
  const zoom = Math.min(maxZoom, Math.max(0.25, Math.min(w / (x1 - x0), h / (y1 - y0))));
  ui.setView({ zoom, x: (w - (x1 - x0) * zoom) / 2 - x0 * zoom, y: (h - (y1 - y0) * zoom) / 2 - y0 * zoom });
}

/** Centra a vista num aparelho ou cabo («Mostrar»). */
export function centerOn(kind: 'device' | 'wire', id: string) {
  const { project, view } = useApp.getState();
  const { w, h } = canvasSize();
  let c: { x: number; y: number } | null = null;
  if (kind === 'device') {
    const d = project.devices.find((x) => x.id === id);
    if (d) {
      const b = bbox(registry, d);
      c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    }
  } else {
    const wr = project.wires.find((x) => x.id === id);
    const a = wr && project.devices.find((d) => d.id === wr.a.device);
    if (a) c = { x: a.x, y: a.y };
  }
  if (c) ui.setView({ x: w / 2 - c.x * view.zoom, y: h / 2 - c.y * view.zoom });
}

/** Se algum aparelho estiver fora da área visível, enquadra o esquema sem aproximar. */
export function ensureVisible() {
  const { project, view } = useApp.getState();
  const { w, h } = canvasSize();
  const out = project.devices.some((d) => {
    const b = bbox(registry, d);
    const x = b.x * view.zoom + view.x;
    const y = b.y * view.zoom + view.y;
    return x < 0 || y < 0 || x + b.w * view.zoom > w || y + b.h * view.zoom > h;
  });
  if (out) fitView(1);
}
