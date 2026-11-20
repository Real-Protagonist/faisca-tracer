/**
 * Marca e dados do autor: nome da aplicação, copyright e contas para doações.
 * Os nomes e os números não se traduzem. Campos vazios aparecem como «a preencher».
 */

/** Nome mostrado (com acento). Nos ficheiros, no domínio e nas lojas: «Faisca Tracer» / «faisca-tracer». */
export const APP_NAME = 'Faísca Tracer';
export const COPYRIGHT_YEAR = 2023;
/** Autor (copyright no «Sobre»). */
export const AUTHOR = 'Mesaque M. Txangala';

export interface DonationField {
  /** Chave de tradução do rótulo (`ui.donations.field.<key>`). */
  key: 'holder' | 'bank' | 'iban' | 'account' | 'swift' | 'card' | 'link' | 'address' | 'network';
  value: string;
}

export interface DonationMethod {
  /** Chave de tradução do título (`ui.donations.<id>.title`) e da nota (`ui.donations.<id>.note`). */
  id: 'international' | 'bank' | 'bitcoin';
  fields: DonationField[];
}

/** Contas para doações: transferência internacional (IBAN + SWIFT/BIC), nacional (banco angolano) e Bitcoin. */
export const DONATIONS: DonationMethod[] = [
  {
    id: 'international',
    fields: [
      { key: 'bank', value: 'Banking Circle S.A.' },
      { key: 'holder', value: 'MESAQUE MANUEL TXANGALA' },
      { key: 'iban', value: 'LU834080000044233156' },
      { key: 'swift', value: 'BCIRLULL' },
    ],
  },
  {
    id: 'bank',
    fields: [
      { key: 'bank', value: 'Banco BIC' },
      { key: 'holder', value: 'MESAQUE MANUEL TXANGALA' },
      // { key: 'account', value: '00000000000000000000' },
      { key: 'iban', value: 'AO06.005100008175466414176' },
    ],
  },
  {
    id: 'bitcoin',
    fields: [
      { key: 'network', value: 'Bitcoin (BTC)' },
      { key: 'address', value: '124bKWuYgkHY3SJodpByCar1RBwVXMEgn5' },
    ],
  },
];
