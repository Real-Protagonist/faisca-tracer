/** Modelo de dados do projecto `.faisca` (JSON versionado). */

export type Domain = 'domestic' | 'industrial';
export type Level = 'beginner' | 'pro';
export type Lang = 'pt' | 'en' | 'fr';
export type Frequency = 50 | 60;

/** Condutor de um cabo; define a cor (IEC 60445). */
export type Conductor = 'L1' | 'L2' | 'L3' | 'N' | 'PE' | 'C' | 'DC+' | 'DC-';
export type Material = 'Cu' | 'Al';
/** Modo de instalação (IEC 60364-5-52). */
export type InstallMethod = 'A1' | 'B1' | 'C';

export type ParamValue = number | string | boolean;

export interface Device {
  id: string;
  type: string;
  /** Designação IEC 81346 (Q1, H1…) ou nome dado pelo utilizador. Nunca traduzido. */
  name: string;
  x: number;
  y: number;
  rot: number;
  params: Record<string, ParamValue>;
  /** Estado discreto que se guarda no ficheiro (aberto/fechado, disparado, fundido…). */
  state: Record<string, unknown>;
}

export interface WireEnd {
  device: string;
  terminal: string;
}

export interface WireFault {
  /** Fio cortado. */
  cut?: boolean;
  /** Ligação solta: resistência de contacto acrescentada (Ω). */
  contactResistance?: number;
}

export interface Wire {
  id: string;
  a: WireEnd;
  b: WireEnd;
  conductor: Conductor;
  /** Secção (mm²). */
  section: number;
  /** Comprimento (m). */
  length: number;
  material: Material;
  method?: InstallMethod;
  fault?: WireFault;
  /**
   * Pontas desligadas do borne (vista 3D ou painel do cabo). O cabo continua no projecto, com as
   * duas pontas atribuídas, mas não conduz: é como tirar o fio do borne e deixá-lo solto.
   */
  detached?: ('a' | 'b')[];
  /** Pontos de curva do desenho (editor 2D). */
  points?: { x: number; y: number }[];
}

export interface Project {
  app: 'faisca';
  version: number;
  domain: Domain;
  level: Level;
  lang: Lang;
  frequency: Frequency;
  devices: Device[];
  wires: Wire[];
  /** Nome dado pelo utilizador. */
  name?: string;
  /** Contador para gerar ids únicos. */
  seq?: number;
}

export const PROJECT_VERSION = 1;
