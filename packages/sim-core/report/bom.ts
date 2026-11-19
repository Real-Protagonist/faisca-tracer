/**
 * Lista de material: aparelhos agrupados por tipo e características (calibre, curva, potência…)
 * e metros de cabo por secção, material e cor. Os textos (nomes e opções) traduzem-se na interface.
 */
import type { Conductor, Material, ParamValue, Project } from '../project/types';
import type { Registry } from '../devices/registry';

export interface BomSpec {
  key: string;
  value: ParamValue;
  unit?: string;
  /** O valor é uma opção traduzida (`option.<key>.<valor>`). */
  translated?: boolean;
}

export interface BomDeviceRow {
  type: string;
  spec: BomSpec[];
  qty: number;
  /** Designações (Q1, Q2…). */
  names: string[];
}

export interface BomCableRow {
  conductor: Conductor;
  section: number;
  material: Material;
  /** Comprimento total (m). */
  length: number;
  count: number;
}

export interface Bom {
  devices: BomDeviceRow[];
  cables: BomCableRow[];
}

export function billOfMaterials(P: Project, registry: Registry): Bom {
  const devices = new Map<string, BomDeviceRow>();
  for (const d of P.devices) {
    const def = registry.get(d.type);
    if (!def || def.annotation || def.category === 'faults') continue;
    // Características de catálogo: parâmetros visíveis no nível Iniciante (os do Profissional são de afinação).
    const spec: BomSpec[] = def.params
      .filter((p) => !p.hidden && !p.pro && p.kind !== 'text')
      .map((p) => ({ key: p.key, value: d.params[p.key] ?? p.default, unit: p.unit, translated: p.translatedOptions }));
    const key = d.type + JSON.stringify(spec.map((s) => s.value));
    const row = devices.get(key);
    if (row) {
      row.qty++;
      row.names.push(d.name);
    } else devices.set(key, { type: d.type, spec, qty: 1, names: [d.name] });
  }
  const cables = new Map<string, BomCableRow>();
  for (const w of P.wires) {
    const key = `${w.section}|${w.material}|${w.conductor}`;
    const row = cables.get(key);
    if (row) {
      row.length += w.length;
      row.count++;
    } else cables.set(key, { conductor: w.conductor, section: w.section, material: w.material, length: w.length, count: 1 });
  }
  const order = registry.all().map((d) => d.type);
  return {
    devices: [...devices.values()].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.names[0]!.localeCompare(b.names[0]!, undefined, { numeric: true })),
    cables: [...cables.values()].sort((a, b) => a.section - b.section || a.conductor.localeCompare(b.conductor)),
  };
}
