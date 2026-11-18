/**
 * Contrato de um equipamento: dados + comportamento num só módulo.
 * Acrescentar um equipamento = escrever um `DeviceDef` e registá-lo. O solver e a interface
 * não mudam.
 *
 * Chaves de tradução derivadas do tipo:
 *   device.<type>.name, device.<type>.desc
 *   param.<key> (ou `labelKey` do parâmetro), option.<key>.<valor>
 *   meas.<chave> para medições, state.<chave> para estados, action.<id> para comandos.
 */
import type { Quantity } from '../solver/complex';
import type { Device, Domain, Level, ParamValue, Project } from '../project/types';
import type { Diagnostic, Severity } from '../diagnostics/types';
import type { Look, NumFmt, Prim } from './symbols';

export type Category =
  | 'sources'
  | 'protection'
  | 'control'
  | 'sensors'
  | 'loads'
  | 'motors'
  | 'measurement'
  | 'distribution'
  | 'faults'
  | 'annotations';

/**
 * Tipo de terminal: define a cor automática do cabo e as regras de montagem.
 * `any` = terminal de passagem (interruptor, disjuntor…), a cor vem do circuito.
 */
export type TerminalKind = 'L' | 'L1' | 'L2' | 'L3' | 'N' | 'PE' | 'C' | 'DC+' | 'DC-' | 'any';

/** Papel de um terminal de fonte, usado pela análise de montagem. */
export type SourceRole = 'phase' | 'neutral' | 'pe';

export interface TerminalDef {
  id: string;
  /** Posição no símbolo 2D (px, antes da rotação). */
  x: number;
  y: number;
  kind: TerminalKind;
  /** Etiqueta impressa junto ao terminal (marcação normalizada, não traduzida). */
  label?: string;
}

export interface ParamDef {
  key: string;
  kind: 'number' | 'select' | 'text' | 'boolean';
  default: ParamValue;
  unit?: string;
  options?: readonly (number | string)[];
  min?: number;
  max?: number;
  step?: number;
  /** Só visível no perfil Profissional. */
  pro?: boolean;
  /** Chave de tradução do rótulo; por omissão `param.<key>`. */
  labelKey?: string;
  /** As opções têm texto traduzido em `option.<key>.<valor>`. */
  translatedOptions?: boolean;
}

/** Valor de uma medição: número com unidade ou chave de tradução de um estado. */
export type MeasureValue = number | { key: string; values?: Record<string, string> };

export interface Measurement {
  key: string;
  value: MeasureValue;
  unit?: string;
  pro?: boolean;
}

/** Ligação interna entre dois terminais (pólo, contacto). */
export interface Conduction {
  a: string;
  b: string;
  closed: boolean;
}

export interface ActionDef {
  id: string;
  /** Chave de tradução do botão; por omissão `action.<id>`. */
  labelKey?: string;
  /** Acção momentânea (botão de pressão): premir e largar. */
  momentary?: boolean;
  pro?: boolean;
}

/** Funções de estampagem oferecidas ao equipamento. */
export interface StampContext {
  readonly ground: 0;
  readonly omega: number;
  readonly frequency: number;
  readonly level: Level;
  /** Nó de um terminal do equipamento. */
  node(terminal: string): number;
  /** Nó interno do equipamento (criado na primeira chamada). */
  internal(name: string): number;
  R(a: number, b: number, ohms: number, tag?: string): void;
  Z(a: number, b: number, z: { R?: number; L?: number; C?: number }, tag?: string): void;
  V(a: number, b: number, v: { ac?: number; phase?: number; dc?: number }, tag?: string): void;
  I(a: number, b: number, i: { ac?: number; phase?: number; dc?: number }, tag?: string): void;
  X(p1: number, p2: number, s1: number, s2: number, ratio: number, tag?: string): void;
  /** Contacto: só existe quando fechado (1 mΩ). */
  sw(a: number, b: number, closed: boolean, tag?: string): void;
}

/** Leitura dos resultados do passo actual. */
export interface SolutionView {
  /** Tensão do terminal em relação à terra. */
  v(device: Device, terminal: string): Quantity;
  /** Tensão entre dois terminais do mesmo equipamento. */
  vv(device: Device, t1: string, t2: string): Quantity;
  /** Tensão de um terminal de qualquer equipamento. */
  vAt(deviceId: string, terminal: string): Quantity;
  /** Tensão de um nó interno. */
  vInternal(device: Device, name: string): Quantity;
  /** Corrente no elemento com a etiqueta dada (de a para b). */
  i(device: Device, tag: string): Quantity;
  /** Corrente num cabo (de a para b). */
  iWire(wireId: string): Quantity;
  hasAC: boolean;
  hasDC: boolean;
}

export interface EventInput {
  code: string;
  severity: Severity;
  values?: Record<string, string>;
}

export interface LogicContext {
  readonly sol: SolutionView;
  readonly dt: number;
  readonly t: number;
  readonly project: Project;
  /** Regista um evento na lista Eventos (chave `event.<code>`). */
  emit(e: EventInput): void;
  /** Formata uma grandeza no idioma do projecto. */
  fmt(value: number, unit: string): string;
  /** Equipamento por id. */
  device(id: string): Device | undefined;
  /** Corrente de fuga (para a terra) de cada equipamento que a declara. */
  leakages(): { device: Device; current: number }[];
}

export interface DiagnoseContext {
  readonly sol: SolutionView;
  readonly project: Project;
  fmt(value: number, unit: string): string;
}

export interface LoadInfo {
  /** Terminal de fase e terminal de retorno (neutro). */
  phase: string;
  neutral: string;
  /** Tensão nominal (V). */
  nominalVoltage(d: Device): number;
  /** Iluminação: limite de queda de tensão de 3 %. */
  lighting?: boolean;
  /** A carga está a funcionar (lâmpada acesa, motor em marcha…). */
  working?(d: Device, sol: SolutionView, rt: any): boolean;
}

export interface ProtectionInfo {
  /** Terminais de saída (lado da carga). */
  outputs: string[];
  /** Terminais de entrada. */
  inputs: string[];
  ratedCurrent(d: Device): number;
}

export interface DeviceDef<RT extends object = any> {
  type: string;
  category: Category;
  domain: Domain[];
  level: Level;
  /** Letra IEC 81346 para o nome automático. */
  prefix: string;
  /** Tamanho do símbolo 2D (px). */
  size: { w: number; h: number };
  /** Tamanho variável (moldura); por omissão `size`. */
  sizeOf?(d: Device): { w: number; h: number };
  terminals: TerminalDef[];
  params: ParamDef[];
  initialState(): Record<string, unknown>;
  /** Grupos de terminais que são o mesmo nó (ligadores, barramentos). */
  shorts?(d: Device): string[][];
  /** Ligações internas que podem abrir (pólos, contactos). */
  conducts?(d: Device): Conduction[];
  /** Papel dos terminais de uma fonte (fase, neutro, terra). */
  sourceRoles?(d: Device): Record<string, SourceRole>;
  /** Interruptor unipolar: tem de cortar a fase. */
  phaseOnlySwitch?: boolean;
  /** Aparelho de classe I: a massa tem de estar ligada ao PE. */
  classI?: boolean;
  load?: LoadInfo;
  protection?: ProtectionInfo;
  stamp?(d: Device, b: StampContext, rt: RT): void;
  /** Lógica discreta; devolve true se o estado mudou (obriga a resolver outra vez). */
  logic?(d: Device, ctx: LogicContext, rt: RT): boolean;
  measure?(d: Device, sol: SolutionView, rt: RT, ctx: { fmt(v: number, u: string): string }): Measurement[];
  actions?(d: Device): ActionDef[];
  /** Executa um comando. `phase` = 'down'/'up' nos comandos momentâneos. */
  operate?(d: Device, action: string, rt: RT, phase?: 'down' | 'up'): boolean;
  /** Diagnósticos próprios do equipamento (disparos, fusão…). */
  diagnose?(d: Device, ctx: DiagnoseContext, rt: RT): Diagnostic[];
  /** Corrente de fuga deste equipamento para a terra ou PE (A). */
  leakage?(d: Device, sol: SolutionView): number;
  /** Repõe o estado de serviço (rearmar, substituir) para o cálculo de Icc. */
  forceClosed?(d: Device): void;
  /** Símbolo 2D IEC 60617, como dados (ver `symbols.ts`). */
  symbol?(d: Device, look: Look, n: NumFmt): Prim[];
  /** Equipamento sem efeito eléctrico (moldura, nota). */
  annotation?: boolean;
  /** Modelo 3D (Fase 5). */
  model3d?: string;
  /** Chaves `simpl.*` das simplificações do modelo físico. */
  simplifications?: string[];
}
