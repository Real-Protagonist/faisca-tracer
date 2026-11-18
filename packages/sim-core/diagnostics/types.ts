/** Contrato de cada diagnóstico (ver prompt de construção, secção «Detecção de falhas»). */

export type Severity = 'error' | 'warning' | 'info';

export interface DiagTarget {
  kind: 'device' | 'wire';
  id: string;
}

export interface Diagnostic {
  code: string;
  severity: Severity;
  targets: DiagTarget[];
  titleKey: string;
  causeKey: string;
  hintKey: string;
  learnKey: string;
  values: Record<string, string>;
  fix?: { action: 'select'; id: string };
}

/** Constrói um diagnóstico com as chaves `diag.<code em minúsculas>.*`. */
export function diag(
  code: string,
  severity: Severity,
  targets: DiagTarget[],
  values: Record<string, string>,
  fixId?: string,
): Diagnostic {
  const k = 'diag.' + code.toLowerCase();
  const d: Diagnostic = {
    code,
    severity,
    targets,
    titleKey: k + '.title',
    causeKey: k + '.cause',
    hintKey: k + '.hint',
    learnKey: k + '.learn',
    values,
  };
  if (fixId) d.fix = { action: 'select', id: fixId };
  return d;
}

export const dev = (id: string): DiagTarget => ({ kind: 'device', id });
export const wire = (id: string): DiagTarget => ({ kind: 'wire', id });
