/** Registo de equipamentos. A biblioteca filtra por área e nível. */
import type { Domain, Level, ParamValue } from '../project/types';
import type { DeviceDef } from './types';

export class Registry {
  private defs = new Map<string, DeviceDef>();

  register(...defs: DeviceDef[]): this {
    for (const d of defs) {
      if (this.defs.has(d.type)) throw new Error(`Equipamento duplicado: ${d.type}`);
      this.defs.set(d.type, d);
    }
    return this;
  }

  get(type: string): DeviceDef | undefined {
    return this.defs.get(type);
  }

  require(type: string): DeviceDef {
    const d = this.defs.get(type);
    if (!d) throw new Error(`Tipo de equipamento desconhecido: ${type}`);
    return d;
  }

  all(): DeviceDef[] {
    return [...this.defs.values()];
  }

  /**
   * Equipamentos visíveis na biblioteca. No nível Iniciante só os marcados `beginner`;
   * a área industrial inclui também os básicos domésticos.
   */
  library(domain: Domain, level: Level): DeviceDef[] {
    return this.all().filter((d) => {
      const inDomain = d.domain.includes(domain) || (domain === 'industrial' && d.domain.includes('domestic') && d.level === 'beginner');
      return inDomain && (level === 'pro' || d.level === 'beginner');
    });
  }

  defaults(type: string): Record<string, ParamValue> {
    const o: Record<string, ParamValue> = {};
    for (const p of this.require(type).params) o[p.key] = p.default;
    return o;
  }

  clone(): Registry {
    const r = new Registry();
    r.register(...this.all());
    return r;
  }
}
