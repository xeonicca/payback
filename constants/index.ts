import type { Currency } from '@/types'

export const supportedCurrencies: Currency[] = [
  { code: 'TWD', name: '新台幣' },
  { code: 'USD', name: '美元' },
  { code: 'THB', name: '泰銖' },
  { code: 'MYR', name: '馬來西亞令吉' },
  { code: 'VND', name: '越南盾' },
  { code: 'JPY', name: '日圓' },
  { code: 'CNY', name: '人民幣' },
  { code: 'IDR', name: '印尼盾' },
  { code: 'EUR', name: '歐元' },
]

export enum CurrencyCode {
  USD = 'USD',
  THB = 'THB',
  MYR = 'MYR',
  VND = 'VND',
  JPY = 'JPY',
  TWD = 'TWD',
  IDR = 'IDR',
  EUR = 'EUR',
  CNY = 'CNY',
}

export const animalEmojis: string[] = [
  '🦁',
  '🦊',
  '🐻',
  '🐨',
  '🐯',
  '🐸',
  '🐶',
  '🐱',
  '🐼',
  '🤖',
  '👻',
  '👽',
  '🤡',
  '👹',
  '👺',
  '🤠',
  '👶',
  '🧑',
]
