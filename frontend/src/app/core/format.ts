import { Pipe, PipeTransform } from '@angular/core';
import { GameDate } from './models';

export const MONTHS = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];

const nf = new Intl.NumberFormat('de-DE');

export function formatNumber(n: number): string {
  return nf.format(Math.round(n));
}

export function formatMoney(n: number): string {
  return `§ ${nf.format(Math.round(n))}`;
}

export function formatCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1).replace('.', ',')} Mio.`;
  if (abs >= 1e4) return `${(n / 1e3).toFixed(1).replace('.', ',')} Tsd.`;
  return nf.format(Math.round(n));
}

export function formatDate(d: GameDate): string {
  return `${d.day}. ${MONTHS[d.month - 1]} ${d.year}`;
}

@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  transform(v: number | null | undefined): string {
    return formatMoney(v ?? 0);
  }
}

@Pipe({ name: 'num' })
export class NumPipe implements PipeTransform {
  transform(v: number | null | undefined): string {
    return formatNumber(v ?? 0);
  }
}

@Pipe({ name: 'gameDate' })
export class GameDatePipe implements PipeTransform {
  transform(v: GameDate | null | undefined): string {
    return v ? formatDate(v) : '';
  }
}
