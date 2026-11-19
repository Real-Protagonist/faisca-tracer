/**
 * Marca e dados do autor: nome da aplicação, copyright e contas para doações.
 * Os nomes e os números não se traduzem. Campos vazios aparecem como «a preencher».
 */

/** Nome mostrado (com acento). Nos ficheiros, no domínio e nas lojas: «Faisca Tracer» / «faisca-tracer». */
export const APP_NAME = 'Faísca Tracer';
export const COPYRIGHT_YEAR = 2023;
/** Autor (copyright no «Sobre»). */
export const AUTHOR = '';

export interface DonationField {
  /** Chave de tradução do rótulo (`ui.donations.field.<key>`). */
  key: 'holder' | 'bank' | 'iban' | 'account' | 'swift' | 'card' | 'link' | 'address' | 'network';
  value: string;
}

export interface DonationMethod {
  /** Chave de tradução do título (`ui.donations.<id>.title`) e da nota (`ui.donations.<id>.note`). */
  id: 'visa' | 'bank' | 'bitcoin';
  fields: DonationField[];
}

/** Contas para doações: internacional (Visa), nacional (banco angolano) e Bitcoin. */
export const DONATIONS: DonationMethod[] = [
  {
    id: 'visa',
    fields: [
      { key: 'holder', value: '' },
      { key: 'link', value: '' },
    ],
  },
  {
    id: 'bank',
    fields: [
      { key: 'bank', value: '' },
      { key: 'holder', value: '' },
      { key: 'account', value: '' },
      { key: 'iban', value: '' },
    ],
  },
  {
    id: 'bitcoin',
    fields: [
      { key: 'network', value: 'Bitcoin (BTC)' },
      { key: 'address', value: '' },
    ],
  },
];
