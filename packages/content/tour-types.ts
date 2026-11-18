/** Contrato dos passos do tour: `{ id, targetSelector, textKey, waitFor: { type, params }, showMeAction }`. */

export interface TermRef {
  /** Tipo de equipamento (o primeiro desse tipo no projecto). */
  type: string;
  terminal?: string;
}

export type Condition =
  | { type: 'next' }
  | { type: 'deviceExists'; params: { type: string } }
  | { type: 'wire'; params: { a: TermRef; b: TermRef; conductor?: string } }
  /** Cabos encadeados: chain[0] → um terminal de chain[1] → outro terminal de chain[1] → … */
  | { type: 'chain'; params: { chain: TermRef[] } }
  | { type: 'loadState'; params: { type: string; state: string } }
  | { type: 'probe'; params: { type: string; min: number; max: number } }
  | { type: 'tab'; params: { tab: 'logic' | 'physical' } }
  | { type: 'event'; params: { code: string } }
  | { type: 'flag'; params: { flag: string } }
  | { type: 'deviceState'; params: { type: string; key: string; value: unknown } }
  /** Parâmetro numérico do primeiro equipamento do tipo dentro de [min, max]. */
  | { type: 'param'; params: { type: string; key: string; min: number; max: number } }
  /** Um diagnóstico está (ou não está) presente. */
  | { type: 'diag'; params: { code: string; present: boolean } }
  /** O cabo entre os dois terminais existe e está (ou não) cortado. */
  | { type: 'wireCut'; params: { a: TermRef; b: TermRef; cut: boolean } }
  | { type: 'all'; params: { conditions: Condition[] } };

export type ShowMe =
  | { type: 'place'; params: { type: string; x: number; y: number } }
  | { type: 'wire'; params: { a: TermRef; b: TermRef } }
  | { type: 'operate'; params: { type: string; action: string } }
  | { type: 'probe'; params: { type: string } }
  | { type: 'tab'; params: { tab: 'logic' | 'physical' } }
  | { type: 'flag'; params: { flag: string } }
  /** Premir e largar um botão de pressão. */
  | { type: 'press'; params: { type: string } }
  | { type: 'param'; params: { type: string; key: string; value: number | string } }
  | { type: 'wireCut'; params: { a: TermRef; b: TermRef; cut: boolean } }
  | { type: 'sequence'; params: { actions: ShowMe[] } };

export interface TourStep {
  id: string;
  /** Número do passo mostrado na barra de progresso («Passo 4 de 12»). */
  step: number;
  targetSelector: string;
  textKey: string;
  waitFor: Condition;
  /** Códigos de diagnóstico que contam como erro neste passo (o tour explica-os). */
  mistakes?: string[];
  showMeAction?: ShowMe;
}

export interface Tour {
  id: string;
  domain: 'domestic' | 'industrial';
  titleKey: string;
  /** Texto do fim do tour (por omissão `tour.ui.done.text`). */
  doneTextKey?: string;
  steps: TourStep[];
}
