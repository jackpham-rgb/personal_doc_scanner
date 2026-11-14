import { describe, expect, test } from 'vitest';
import { analyze } from '../src/analyzer';
import { sanitizeFileName } from '../src/types';

const scannedAt = new Date(2026, 10, 10, 14, 32);
const run = (text: string) => analyze(text, scannedAt);
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);

const COSTCO = `
COSTCO WHOLESALE
Richmond #482
4801 Central Ave
Member 111234567890
KS PAPER TOWEL      21.99
ROTISSERIE CHICKEN   4.99
ORGANIC EGGS         7.49
SUBTOTAL           114.25
TAX                 10.28
**** TOTAL         124.53
VISA               124.53
CHANGE DUE           0.00
11/05/2026 17:42 482 12 34 56
TOTAL NUMBER OF ITEMS SOLD = 9
THANK YOU! PLEASE COME AGAIN
`;

describe('receipts', () => {
  test('names a Costco receipt like the spec example', () => {
    const a = run(COSTCO);
    expect(a.category).toBe('receipt');
    expect(a.vendor).toBe('Costco');
    expect(a.date).toEqual(day(2026, 11, 5));
    expect(a.amount).toBe(124.53);
    expect(a.title).toBe('Costco Receipt Nov 2026');
  });

  test('reads a total that OCR put on the following line', () => {
    const a = run('Corner Bakery Cafe\nReceipt\nCroissant\n3.50\nSubtotal\n3.50\nTotal\n3.82\nCash');
    expect(a.amount).toBe(3.82);
  });

  test('falls back to the header line for an unknown shop', () => {
    const a = run(
      'BLUE DOOR HARDWARE\n221 Main Street\nTel 510-555-0199\nReceipt #20931\n' +
        'Hammer   12.00\nSubtotal 12.00\nSales Tax 1.11\nTotal    13.11\n03/14/2026',
    );
    expect(a.category).toBe('receipt');
    expect(a.vendor).toBe('Blue Door Hardware');
    expect(a.title).toBe('Blue Door Hardware Receipt Mar 2026');
  });

  test('uses the scan date when the receipt has no date', () => {
    const a = run('Target\nSubtotal 5.00\nTotal 5.45\nChange due 0.00');
    expect(a.date).toBeUndefined();
    expect(a.title).toBe('Target Receipt Nov 2026');
  });
});

describe('IDs', () => {
  test('names a passport without a date', () => {
    const a = run(
      'UNITED STATES OF AMERICA\nPASSPORT\nSurname DOE\nGiven Names JANE\n' +
        'Nationality UNITED STATES OF AMERICA\nDate of birth 12 Feb 1990\n' +
        'Date of issue 03 Mar 2021\nP<USADOE<<JANE<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<',
    );
    expect(a.category).toBe('id');
    expect(a.title).toBe('Passport Copy');
  });

  test('recognises a passport from the machine-readable zone alone', () => {
    expect(run('P<GBRSMITH<<JOHN<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<').title).toBe('Passport Copy');
  });

  test('names a driver license', () => {
    expect(run('California DRIVER LICENSE\nDL I1234568\nDOB 08/31/1977').title).toBe(
      'Driver License Copy',
    );
  });
});

test('names an electric bill by service and statement month', () => {
  const a = run(`
Pacific Gas and Electric Company
Statement Date: 10/18/2026
Due Date: 11/08/2026
Account Number 1234567890-1
Service Address 12 Oak St
Billing Period 09/17/2026 - 10/16/2026
Electric usage 412 kWh
Previous Balance 80.10
Total Amount Due $96.41
`);
  expect(a.category).toBe('bill');
  expect(a.vendor).toBe('PG&E');
  expect(a.date, 'not the due date').toEqual(day(2026, 10, 18));
  expect(a.amount, 'not the previous balance').toBe(96.41);
  expect(a.title).toBe('Electric Bill Oct 2026');
});

describe('other types', () => {
  test('car insurance', () => {
    const a = run(
      'GEICO\nAutomobile Insurance Policy Declarations\nPolicy Number 4321-88-21-09\n' +
        'Policy Period: 06/01/2026 to 12/01/2026\nNamed Insured: Jane Doe\n' +
        'Coverages   Premium\nBodily Injury Liability\nDeductible $500',
    );
    expect(a.category).toBe('insurance');
    expect(a.typeLabel).toBe('Car Insurance');
    expect(a.title).toMatch(/^GEICO Car Insurance/);
  });

  test('W-2', () => {
    const a = run(
      'Form W-2 Wage and Tax Statement 2025\nEmployer identification number 12-3456789\n' +
        'Federal income tax withheld 8,400.00\nDepartment of the Treasury - Internal Revenue Service',
    );
    expect(a.category).toBe('tax');
    expect(a.typeLabel).toBe('W-2');
  });

  test('unknown document is titled from its heading', () => {
    const a = run('Garden Club Meeting Notes\nWe met on the lawn.');
    expect(a.category).toBe('other');
    expect(a.title).toBe('Garden Club Meeting Notes Nov 2026');
  });

  test('blank page gets a timestamp title', () => {
    expect(run('').title).toBe('Scan 2026-11-10 14.32');
  });
});

describe('dates', () => {
  const dateOf = (text: string) => run(text).date;

  test('reads common formats', () => {
    expect(dateOf('2026-03-09')).toEqual(day(2026, 3, 9));
    expect(dateOf('March 9, 2026')).toEqual(day(2026, 3, 9));
    expect(dateOf('9 Mar 2026')).toEqual(day(2026, 3, 9));
    expect(dateOf('Sept. 9th, 2026')).toEqual(day(2026, 9, 9));
    expect(dateOf('03/09/26')).toEqual(day(2026, 3, 9));
  });

  test('swaps day and month when month-first is impossible', () => {
    expect(dateOf('25/03/2026')).toEqual(day(2026, 3, 25));
  });

  test('ignores impossible and far-future dates', () => {
    expect(dateOf('02/31/2026')).toBeUndefined();
    expect(dateOf('01/01/2031')).toBeUndefined();
  });

  test('prefers the issue date over a date of birth', () => {
    expect(dateOf('DOB: 04/02/1985\nVisit 06/11/2026')).toEqual(day(2026, 6, 11));
  });
});

test('titles are safe as file names', () => {
  expect(sanitizeFileName('A/B: "C" <D>?')).toBe('A B C D');
  expect(sanitizeFileName('   ')).toBe('Document');
  expect(sanitizeFileName('Report v1.')).toBe('Report v1');
});
