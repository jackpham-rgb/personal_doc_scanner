import 'package:doc_scanner/models/document.dart';
import 'package:doc_scanner/services/document_analyzer.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const analyzer = DocumentAnalyzer();
  final scannedAt = DateTime(2026, 11, 10, 14, 32);

  DocumentAnalysis analyze(String text) =>
      analyzer.analyze(text, scannedAt: scannedAt);

  group('receipts', () {
    const costco = '''
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
''';

    test('names a Costco receipt like the spec example', () {
      final a = analyze(costco);
      expect(a.category, DocCategory.receipt);
      expect(a.vendor, 'Costco');
      expect(a.date, DateTime(2026, 11, 5));
      expect(a.amount, 124.53);
      expect(a.title, 'Costco Receipt Nov 2026');
    });

    test('takes the total, not the subtotal or the item count', () {
      expect(analyze(costco).amount, isNot(114.25));
    });

    test('reads a total that OCR put on the following line', () {
      final a = analyze('''
Corner Bakery Cafe
Receipt
Croissant
3.50
Subtotal
3.50
Total
3.82
Cash
''');
      expect(a.amount, 3.82);
    });

    test('falls back to the header line for an unknown shop', () {
      final a = analyze('''
BLUE DOOR HARDWARE
221 Main Street
Tel 510-555-0199
Receipt #20931
Hammer   12.00
Subtotal 12.00
Sales Tax 1.11
Total    13.11
03/14/2026
''');
      expect(a.category, DocCategory.receipt);
      expect(a.vendor, 'Blue Door Hardware');
      expect(a.title, 'Blue Door Hardware Receipt Mar 2026');
    });

    test('uses the scan date when the receipt has no date', () {
      final a = analyze('Target\nSubtotal 5.00\nTotal 5.45\nChange due 0.00');
      expect(a.date, isNull);
      expect(a.title, 'Target Receipt Nov 2026');
    });
  });

  group('IDs', () {
    test('names a passport without a date', () {
      final a = analyze('''
UNITED STATES OF AMERICA
PASSPORT
Surname DOE
Given Names JANE
Nationality UNITED STATES OF AMERICA
Date of birth 12 Feb 1990
Date of issue 03 Mar 2021
Date of expiration 02 Mar 2031
P<USADOE<<JANE<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
''');
      expect(a.category, DocCategory.id);
      expect(a.title, 'Passport Copy');
    });

    test('recognises a passport from the machine-readable zone alone', () {
      final a = analyze('P<GBRSMITH<<JOHN<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<');
      expect(a.category, DocCategory.id);
      expect(a.title, 'Passport Copy');
    });

    test('names a driver license', () {
      final a = analyze(
        'California DRIVER LICENSE\nDL I1234568\nDOB 08/31/1977',
      );
      expect(a.category, DocCategory.id);
      expect(a.title, 'Driver License Copy');
    });
  });

  group('bills', () {
    test('names an electric bill by service and statement month', () {
      final a = analyze('''
Pacific Gas and Electric Company
Statement Date: 10/18/2026
Due Date: 11/08/2026
Account Number 1234567890-1
Service Address 12 Oak St
Billing Period 09/17/2026 - 10/16/2026
Electric usage 412 kWh
Previous Balance 80.10
Total Amount Due \$96.41
''');
      expect(a.category, DocCategory.bill);
      expect(a.vendor, 'PG&E');
      expect(a.date, DateTime(2026, 10, 18), reason: 'not the due date');
      expect(a.amount, 96.41, reason: 'not the previous balance');
      expect(a.title, 'Electric Bill Oct 2026');
    });
  });

  group('other types', () {
    test('car insurance', () {
      final a = analyze('''
GEICO
Automobile Insurance Policy Declarations
Policy Number 4321-88-21-09
Policy Period: 06/01/2026 to 12/01/2026
Named Insured: Jane Doe
Coverages   Premium
Bodily Injury Liability
Deductible \$500
''');
      expect(a.category, DocCategory.insurance);
      expect(a.typeLabel, 'Car Insurance');
      expect(a.title, startsWith('GEICO Car Insurance'));
    });

    test('W-2', () {
      final a = analyze('''
Form W-2 Wage and Tax Statement 2025
Employer identification number 12-3456789
Federal income tax withheld 8,400.00
Department of the Treasury - Internal Revenue Service
''');
      expect(a.category, DocCategory.tax);
      expect(a.typeLabel, 'W-2');
    });

    test('unknown document is titled from its heading', () {
      final a = analyze('Garden Club Meeting Notes\nWe met on the lawn.');
      expect(a.category, DocCategory.other);
      expect(a.title, 'Garden Club Meeting Notes Nov 2026');
    });

    test('blank page gets a timestamp title', () {
      final a = analyze('');
      expect(a.category, DocCategory.other);
      expect(a.title, 'Scan 2026-11-10 14.32');
    });
  });

  group('dates', () {
    DateTime? dateOf(String text) => analyze(text).date;

    test('reads common formats', () {
      expect(dateOf('2026-03-09'), DateTime(2026, 3, 9));
      expect(dateOf('March 9, 2026'), DateTime(2026, 3, 9));
      expect(dateOf('9 Mar 2026'), DateTime(2026, 3, 9));
      expect(dateOf('Sept. 9th, 2026'), DateTime(2026, 9, 9));
      expect(dateOf('03/09/26'), DateTime(2026, 3, 9));
    });

    test('swaps day and month when month-first is impossible', () {
      expect(dateOf('25/03/2026'), DateTime(2026, 3, 25));
    });

    test('ignores impossible and far-future dates', () {
      expect(dateOf('02/31/2026'), isNull);
      expect(dateOf('01/01/2031'), isNull);
    });

    test('prefers the issue date over a date of birth', () {
      expect(
        dateOf('DOB: 04/02/1985\nVisit 06/11/2026'),
        DateTime(2026, 6, 11),
      );
    });
  });

  test('titles are safe as file names', () {
    expect(sanitizeFileName('A/B: "C" <D>?'), 'A B C D');
    expect(sanitizeFileName('   '), 'Document');
    expect(sanitizeFileName('Report v1.'), 'Report v1');
  });
}
