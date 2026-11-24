/** Funções simples sobre cabos, sem dependências (usadas pelo solver e pelos diagnósticos). */
import type { Wire } from './types';

/** O cabo liga as duas pontas? Não, se estiver cortado ou com uma ponta desligada do borne. */
export const wireConducts = (w: Wire): boolean => !w.fault?.cut && !w.detached?.length;
