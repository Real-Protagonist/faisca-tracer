/** Anotações: moldura de quadro e nota de texto. Não têm efeito eléctrico. */
import { num } from './common';
import type { DeviceDef } from './types';

/** Moldura que agrupa visualmente os aparelhos de um quadro. O título é do utilizador. */
export const frame: DeviceDef = {
  type: 'frame',
  category: 'annotations',
  domain: ['domestic', 'industrial'],
  level: 'beginner',
  prefix: 'QD',
  size: { w: 400, h: 300 },
  terminals: [],
  params: [{ key: 'title', kind: 'text', default: '' }, num('W', 400, 'px', 100, 4000, 20), num('H', 300, 'px', 80, 4000, 20)],
  initialState: () => ({}),
  annotation: true,
  sizeOf: (d) => ({ w: Number(d.params.W) || 400, h: Number(d.params.H) || 300 }),
  symbol: (d) => [{ t: 'rect', x: 0, y: 0, w: Number(d.params.W), h: Number(d.params.H), cls: 'frame', rx: 6 }, { t: 'text', x: 10, y: 18, text: String(d.params.title ?? ''), cls: 'txt frame-title', anchor: 'start' }],
};

/** Nota de texto livre. O texto é do utilizador e não é traduzido. */
export const note: DeviceDef = {
  type: 'note',
  category: 'annotations',
  domain: ['domestic', 'industrial'],
  level: 'beginner',
  prefix: 'NT',
  size: { w: 200, h: 80 },
  terminals: [],
  params: [{ key: 'text', kind: 'text', default: '' }],
  initialState: () => ({}),
  annotation: true,
  symbol(d) {
    const words = String(d.params.text ?? '').split(/\s+/);
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      if ((cur + ' ' + w).trim().length > 32) {
        lines.push(cur.trim());
        cur = w;
      } else cur += ' ' + w;
    }
    if (cur.trim()) lines.push(cur.trim());
    return [{ t: 'rect', x: 0, y: 0, w: 200, h: 80, cls: 'note', rx: 4 }, ...lines.slice(0, 5).map((l, i) => ({ t: 'text' as const, x: 8, y: 17 + i * 14, text: l, cls: 'txt note-text', anchor: 'start' as const }))];
  },
};

export const annotations = [frame, note];
