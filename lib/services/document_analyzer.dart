import '../models/document.dart';

/// What the analyzer worked out about a document from its OCR text.
class DocumentAnalysis {
  const DocumentAnalysis({
    required this.category,
    required this.typeLabel,
    required this.title,
    this.vendor,
    this.date,
    this.amount,
  });

  final DocCategory category;

  /// Specific type used in the title, e.g. "Electric Bill" or "Passport".
  final String typeLabel;
  final String title;
  final String? vendor;
  final DateTime? date;
  final double? amount;
}

/// Rule-based document understanding: classifies OCR text, pulls out the
/// vendor, date and total, and proposes a file name.
///
/// Everything here is plain Dart with no platform dependencies, so it runs
/// offline and is unit-tested directly.
class DocumentAnalyzer {
  const DocumentAnalyzer();

  DocumentAnalysis analyze(String text, {required DateTime scannedAt}) {
    final lower = text.toLowerCase();
    final lines = text
        .split('\n')
        .map((l) => l.trim())
        .where((l) => l.isNotEmpty)
        .toList();

    final category = _classify(lower);
    final typeLabel = _typeLabel(category, lower);
    final date = _findDate(lines, scannedAt);
    final amount = _moneyCategories.contains(category)
        ? _findAmount(lines)
        : null;
    final vendor =
        _knownVendor(lower) ??
        (_headerVendorCategories.contains(category)
            ? _headerVendor(lines)
            : null);

    return DocumentAnalysis(
      category: category,
      typeLabel: typeLabel,
      vendor: vendor,
      date: date,
      amount: amount,
      title: _buildTitle(
        category: category,
        typeLabel: typeLabel,
        vendor: vendor,
        date: date,
        scannedAt: scannedAt,
        lines: lines,
      ),
    );
  }

  // ---------------------------------------------------------------- classify

  static const _moneyCategories = {
    DocCategory.receipt,
    DocCategory.invoice,
    DocCategory.bill,
  };

  static const _headerVendorCategories = {
    DocCategory.receipt,
    DocCategory.invoice,
  };

  /// Keyword → weight per category. A phrase counts once however often it
  /// appears, so one very repetitive document cannot swamp the score.
  static const Map<DocCategory, Map<String, int>> _keywords = {
    DocCategory.receipt: {
      'receipt': 4,
      'subtotal': 3,
      'sub total': 3,
      'change due': 3,
      'cashier': 3,
      'items sold': 3,
      'thank you for shopping': 4,
      'thank you for your purchase': 3,
      'approved': 1,
      'visa': 1,
      'mastercard': 1,
      'debit': 1,
      'sales tax': 2,
      'total': 1,
      'cash': 1,
      'tender': 2,
      'store #': 2,
      'register': 1,
      'refund policy': 2,
    },
    DocCategory.invoice: {
      'invoice': 5,
      'invoice number': 3,
      'invoice no': 3,
      'invoice date': 3,
      'bill to': 3,
      'ship to': 2,
      'payment terms': 3,
      'purchase order': 2,
      'net 30': 2,
      'remit to': 2,
    },
    DocCategory.bill: {
      'electric': 3,
      'electricity': 3,
      'kwh': 4,
      'therms': 4,
      'utility': 3,
      'utilities': 3,
      'water service': 3,
      'sewer': 3,
      'billing period': 3,
      'service address': 3,
      'amount due': 2,
      'meter reading': 4,
      'meter number': 3,
      'internet service': 3,
      'wireless': 2,
      'data plan': 2,
      'monthly charges': 2,
      'previous balance': 2,
      'payment due': 2,
      'late fee': 1,
      'account number': 1,
    },
    DocCategory.bankStatement: {
      'statement period': 3,
      'beginning balance': 4,
      'ending balance': 4,
      'opening balance': 3,
      'closing balance': 3,
      'account summary': 2,
      'deposits': 2,
      'withdrawals': 3,
      'checking': 2,
      'savings': 2,
      'routing number': 2,
      'member fdic': 3,
      'credit limit': 2,
      'minimum payment': 2,
      'transactions': 1,
    },
    DocCategory.id: {
      'passport': 6,
      'passeport': 4,
      'driver license': 6,
      "driver's license": 6,
      'drivers license': 6,
      'driving licence': 6,
      'identification card': 5,
      'identity card': 5,
      'date of birth': 3,
      'nationality': 3,
      'place of birth': 3,
      'social security': 5,
      'permanent resident': 5,
      'birth certificate': 6,
      'certificate of birth': 6,
      'student id': 4,
      'date of expiry': 2,
      'date of issue': 2,
    },
    DocCategory.insurance: {
      'insurance': 4,
      'policy number': 4,
      'policy no': 3,
      'policyholder': 4,
      'policy period': 3,
      'coverage': 2,
      'coverages': 2,
      'premium': 3,
      'deductible': 3,
      'insured': 3,
      'liability': 2,
      'declarations': 2,
      'claim': 1,
      'underwriter': 2,
      'naic': 3,
    },
    DocCategory.tax: {
      'w-2': 5,
      'wage and tax statement': 6,
      '1099': 4,
      '1040': 4,
      '1098': 4,
      'internal revenue service': 5,
      'department of the treasury': 3,
      'tax return': 5,
      'franchise tax board': 5,
      'taxable income': 3,
      'adjusted gross income': 4,
      'federal income tax withheld': 5,
      'employer identification number': 3,
      'property tax': 4,
      'tax year': 3,
    },
    DocCategory.medical: {
      'patient': 3,
      'diagnosis': 4,
      'prescription': 4,
      'physician': 3,
      'clinic': 2,
      'hospital': 2,
      'medical record': 5,
      'lab results': 4,
      'laboratory': 2,
      'immunization': 4,
      'vaccine': 3,
      'vaccination': 3,
      'explanation of benefits': 4,
      'date of service': 3,
      'provider': 1,
      'dosage': 3,
      'refills': 3,
      'pharmacy': 2,
    },
    DocCategory.contract: {
      'agreement': 3,
      'lease': 3,
      'landlord': 4,
      'tenant': 4,
      'hereby': 3,
      'hereinafter': 4,
      'the parties': 3,
      'terms and conditions': 2,
      'in witness whereof': 5,
      'governing law': 4,
      'shall': 1,
      'contract': 3,
      'lessee': 4,
      'lessor': 4,
      'effective date': 2,
    },
    DocCategory.letter: {
      'dear ': 3,
      'sincerely': 4,
      'best regards': 3,
      'kind regards': 3,
      'yours truly': 4,
      'yours faithfully': 4,
      'to whom it may concern': 5,
      're:': 1,
    },
  };

  static const _minScore = 4;

  DocCategory _classify(String lower) {
    // Machine-readable zone of a passport.
    if (RegExp(r'p<[a-z]{3}[a-z<]{5,}').hasMatch(lower)) return DocCategory.id;

    var best = DocCategory.other;
    var bestScore = 0;
    _keywords.forEach((category, words) {
      var score = 0;
      words.forEach((word, weight) {
        if (_containsPhrase(lower, word)) score += weight;
      });
      if (score > bestScore) {
        bestScore = score;
        best = category;
      }
    });
    return bestScore >= _minScore ? best : DocCategory.other;
  }

  /// Substring match that respects word boundaries where the phrase starts or
  /// ends with a letter or digit, so "rx" does not match inside "marxism".
  static bool _containsPhrase(String lower, String phrase) {
    var from = 0;
    while (true) {
      final i = lower.indexOf(phrase, from);
      if (i < 0) return false;
      final end = i + phrase.length;
      final startOk =
          !_isWordChar(phrase.codeUnitAt(0)) ||
          i == 0 ||
          !_isWordChar(lower.codeUnitAt(i - 1));
      final endOk =
          !_isWordChar(phrase.codeUnitAt(phrase.length - 1)) ||
          end >= lower.length ||
          !_isWordChar(lower.codeUnitAt(end));
      if (startOk && endOk) return true;
      from = i + 1;
    }
  }

  static bool _isWordChar(int c) =>
      (c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x7a);

  /// Ordered most-specific first.
  static const Map<DocCategory, List<(String, String)>> _subtypes = {
    DocCategory.id: [
      ('passport', 'Passport'),
      ('p<', 'Passport'),
      ("driver's license", 'Driver License'),
      ('driver license', 'Driver License'),
      ('drivers license', 'Driver License'),
      ('driving licence', 'Driver License'),
      ('social security', 'Social Security Card'),
      ('permanent resident', 'Green Card'),
      ('birth certificate', 'Birth Certificate'),
      ('certificate of birth', 'Birth Certificate'),
      ('student id', 'Student ID'),
    ],
    DocCategory.bill: [
      ('kwh', 'Electric Bill'),
      ('electric', 'Electric Bill'),
      ('therms', 'Gas Bill'),
      ('natural gas', 'Gas Bill'),
      ('sewer', 'Water Bill'),
      ('water', 'Water Bill'),
      ('internet', 'Internet Bill'),
      ('broadband', 'Internet Bill'),
      ('wireless', 'Phone Bill'),
      ('mobile', 'Phone Bill'),
      ('phone', 'Phone Bill'),
      ('garbage', 'Trash Bill'),
      ('waste', 'Trash Bill'),
    ],
    DocCategory.insurance: [
      ('auto insurance', 'Car Insurance'),
      ('automobile', 'Car Insurance'),
      ('vehicle', 'Car Insurance'),
      ('renters', 'Renters Insurance'),
      ('homeowner', 'Home Insurance'),
      ('dental', 'Dental Insurance'),
      ('vision', 'Vision Insurance'),
      ('health', 'Health Insurance'),
      ('medical', 'Health Insurance'),
      ('life insurance', 'Life Insurance'),
    ],
    DocCategory.tax: [
      ('w-2', 'W-2'),
      ('wage and tax statement', 'W-2'),
      ('1099', '1099'),
      ('1098', '1098'),
      ('property tax', 'Property Tax'),
      ('1040', 'Tax Return'),
      ('tax return', 'Tax Return'),
    ],
    DocCategory.medical: [
      ('immunization', 'Immunization Record'),
      ('vaccin', 'Immunization Record'),
      ('prescription', 'Prescription'),
      ('lab results', 'Lab Results'),
      ('explanation of benefits', 'Explanation of Benefits'),
    ],
    DocCategory.contract: [
      ('lease', 'Lease'),
      ('rental agreement', 'Lease'),
      ('employment', 'Employment Contract'),
    ],
  };

  String _typeLabel(DocCategory category, String lower) {
    for (final (needle, label)
        in _subtypes[category] ?? const <(String, String)>[]) {
      if (lower.contains(needle)) return label;
    }
    return category.label;
  }

  // ------------------------------------------------------------------ vendor

  /// Well-known names, matched case-insensitively as whole phrases. The key is
  /// what to look for, the value is how to print it.
  static const Map<String, String> _vendors = {
    'costco': 'Costco',
    'walmart': 'Walmart',
    'wal-mart': 'Walmart',
    'target': 'Target',
    'safeway': 'Safeway',
    "trader joe's": "Trader Joe's",
    'trader joes': "Trader Joe's",
    'whole foods': 'Whole Foods',
    'kroger': 'Kroger',
    'albertsons': 'Albertsons',
    'aldi': 'Aldi',
    'amazon': 'Amazon',
    'home depot': 'Home Depot',
    "lowe's": "Lowe's",
    'ikea': 'IKEA',
    'best buy': 'Best Buy',
    'cvs': 'CVS',
    'walgreens': 'Walgreens',
    'rite aid': 'Rite Aid',
    'starbucks': 'Starbucks',
    "mcdonald's": "McDonald's",
    'chipotle': 'Chipotle',
    'apple store': 'Apple',
    'shell': 'Shell',
    'chevron': 'Chevron',
    '7-eleven': '7-Eleven',
    'pg&e': 'PG&E',
    'pacific gas and electric': 'PG&E',
    'con edison': 'Con Edison',
    'duke energy': 'Duke Energy',
    'comcast': 'Comcast',
    'xfinity': 'Xfinity',
    'at&t': 'AT&T',
    'verizon': 'Verizon',
    't-mobile': 'T-Mobile',
    'spectrum': 'Spectrum',
    'geico': 'GEICO',
    'state farm': 'State Farm',
    'allstate': 'Allstate',
    'progressive': 'Progressive',
    'liberty mutual': 'Liberty Mutual',
    'farmers insurance': 'Farmers',
    'usaa': 'USAA',
    'aaa': 'AAA',
    'kaiser permanente': 'Kaiser',
    'blue cross': 'Blue Cross',
    'blue shield': 'Blue Shield',
    'aetna': 'Aetna',
    'cigna': 'Cigna',
    'unitedhealthcare': 'UnitedHealthcare',
    'chase': 'Chase',
    'bank of america': 'Bank of America',
    'wells fargo': 'Wells Fargo',
    'citibank': 'Citi',
    'capital one': 'Capital One',
    'american express': 'American Express',
    'discover': 'Discover',
    'fedex': 'FedEx',
    'ups store': 'UPS',
    'usps': 'USPS',
    'uber': 'Uber',
    'lyft': 'Lyft',
  };

  /// The known vendor that appears earliest in the text.
  String? _knownVendor(String lower) {
    String? best;
    var bestIndex = lower.length;
    _vendors.forEach((needle, display) {
      final i = _indexOfPhrase(lower, needle);
      if (i >= 0 && i < bestIndex) {
        bestIndex = i;
        best = display;
      }
    });
    return best;
  }

  static int _indexOfPhrase(String lower, String phrase) {
    var from = 0;
    while (true) {
      final i = lower.indexOf(phrase, from);
      if (i < 0) return -1;
      final end = i + phrase.length;
      final startOk = i == 0 || !_isWordChar(lower.codeUnitAt(i - 1));
      final endOk = end >= lower.length || !_isWordChar(lower.codeUnitAt(end));
      if (startOk && endOk) return i;
      from = i + 1;
    }
  }

  static final _genericHeader = RegExp(
    r'^(receipt|invoice|tax invoice|sales receipt|customer copy|merchant copy|'
    r'welcome|thank you|order|statement|bill|page \d+)\b',
    caseSensitive: false,
  );

  /// Shops print their name at the top of a receipt, so fall back to the first
  /// line near the top that looks like a name rather than an address or date.
  String? _headerVendor(List<String> lines) {
    for (final line in lines.take(6)) {
      final letters = RegExp(r'[A-Za-z]').allMatches(line).length;
      final digits = RegExp(r'\d').allMatches(line).length;
      if (letters < 3 || digits > 2) continue;
      if (letters < line.replaceAll(' ', '').length * 0.7) continue;
      if (_genericHeader.hasMatch(line)) continue;
      final words = line
          .replaceAll(RegExp(r"[^A-Za-z0-9&' -]"), ' ')
          .split(RegExp(r'\s+'))
          .where((w) => w.isNotEmpty)
          .take(3)
          .map(_titleCase)
          .join(' ');
      if (words.length >= 3) {
        return words.length > 28 ? words.substring(0, 28).trim() : words;
      }
    }
    return null;
  }

  static String _titleCase(String word) {
    if (word.length <= 3 && word == word.toUpperCase()) return word; // "IBM"
    return word[0].toUpperCase() + word.substring(1).toLowerCase();
  }

  // -------------------------------------------------------------------- date

  static const _months = [
    'jan',
    'feb',
    'mar',
    'apr',
    'may',
    'jun',
    'jul',
    'aug',
    'sep',
    'oct',
    'nov',
    'dec',
  ];
  static const _monthPattern =
      r'(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?';

  static final _numericDate = RegExp(
    r'(?<!\d)(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4}|\d{2})(?!\d)',
  );
  static final _isoDate = RegExp(
    r'(?<!\d)(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})(?!\d)',
  );
  static final _monthFirst = RegExp(
    '\\b$_monthPattern\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b',
    caseSensitive: false,
  );
  static final _dayFirst = RegExp(
    '\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+$_monthPattern,?\\s+(\\d{4})\\b',
    caseSensitive: false,
  );
  static final _dateHint = RegExp(r'\bdate\b|\bdated\b', caseSensitive: false);
  static final _dateAntiHint = RegExp(
    r'birth|\bdob\b|born|expir|\bexp\b|due|valid|until|issue|member since',
    caseSensitive: false,
  );

  /// Picks the date that most likely says when the document was issued.
  ///
  /// Slash dates are read month-first (US style) unless that is impossible.
  DateTime? _findDate(List<String> lines, DateTime scannedAt) {
    DateTime? best;
    var bestScore = -1000;

    void consider(DateTime? date, String line) {
      if (date == null) return;
      // Documents are not dated far in the future or before most people were
      // keeping paperwork; such matches are OCR noise or other numbers.
      if (date.year < 1990 || date.isAfter(scannedAt.add(_futureSlack))) {
        return;
      }
      var score = 0;
      if (_dateHint.hasMatch(line)) score += 2;
      if (_dateAntiHint.hasMatch(line)) score -= 5;
      if (score > bestScore) {
        bestScore = score;
        best = date;
      }
    }

    for (final line in lines) {
      for (final m in _isoDate.allMatches(line)) {
        consider(_date(m[1]!, m[2]!, m[3]!), line);
      }
      for (final m in _numericDate.allMatches(line)) {
        var month = int.parse(m[1]!);
        var day = int.parse(m[2]!);
        if (month > 12 && day <= 12) (month, day) = (day, month);
        consider(_date(_fullYear(m[3]!), '$month', '$day'), line);
      }
      for (final m in _monthFirst.allMatches(line)) {
        consider(_date(m[3]!, '${_month(m[1]!)}', m[2]!), line);
      }
      for (final m in _dayFirst.allMatches(line)) {
        consider(_date(m[3]!, '${_month(m[2]!)}', m[1]!), line);
      }
    }
    return best;
  }

  static const _futureSlack = Duration(days: 60);

  static String _fullYear(String y) => y.length == 4 ? y : '20$y';

  static int _month(String name) =>
      _months.indexOf(name.toLowerCase().substring(0, 3)) + 1;

  static DateTime? _date(String y, String m, String d) {
    final year = int.parse(y), month = int.parse(m), day = int.parse(d);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    final date = DateTime(year, month, day);
    // DateTime rolls 31 Feb over into March; reject instead.
    return date.month == month ? date : null;
  }

  // ------------------------------------------------------------------ amount

  static final _money = RegExp(
    r'(?<![\d.,])\$?\s?(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})(?!\d)',
  );

  /// Label → priority. Higher wins; ties go to the larger amount.
  static final List<(RegExp, int)> _totalLabels = [
    (RegExp(r'grand\s+total', caseSensitive: false), 5),
    (
      RegExp(
        r'(total\s+)?amount\s+due|balance\s+due|total\s+due|amount\s+paid|'
        r'total\s+amount|please\s+pay',
        caseSensitive: false,
      ),
      4,
    ),
    (RegExp(r'(?<!sub)(?<!sub )(?<!sub-)\btotal\b', caseSensitive: false), 3),
    (RegExp(r'\bbalance\b|\bamount\b', caseSensitive: false), 1),
  ];
  static final _notATotal = RegExp(
    r'sub\s?-?total|total\s+(savings|items|tax|discount|number|qty|points)|'
    r'previous\s+balance|beginning\s+balance',
    caseSensitive: false,
  );

  double? _findAmount(List<String> lines) {
    double? best;
    var bestPriority = 0;

    for (var i = 0; i < lines.length; i++) {
      final line = lines[i];
      if (_notATotal.hasMatch(line)) continue;
      var priority = 0;
      for (final (pattern, p) in _totalLabels) {
        if (pattern.hasMatch(line)) {
          priority = p;
          break;
        }
      }
      if (priority == 0) continue;

      // OCR often splits a row into a label line and a value line.
      var amounts = _amountsIn(line);
      if (amounts.isEmpty && i + 1 < lines.length) {
        amounts = _amountsIn(lines[i + 1]);
      }
      if (amounts.isEmpty) continue;
      final amount = amounts.reduce((a, b) => a > b ? a : b);
      if (priority > bestPriority ||
          (priority == bestPriority && amount > (best ?? 0))) {
        bestPriority = priority;
        best = amount;
      }
    }
    return best;
  }

  static List<double> _amountsIn(String line) => [
    for (final m in _money.allMatches(line))
      double.parse('${m[1]!.replaceAll(',', '')}.${m[2]}'),
  ];

  // ------------------------------------------------------------------- title

  String _buildTitle({
    required DocCategory category,
    required String typeLabel,
    required String? vendor,
    required DateTime? date,
    required DateTime scannedAt,
    required List<String> lines,
  }) {
    final monthYear = formatMonthYear(date ?? scannedAt);

    switch (category) {
      case DocCategory.id:
        // IDs are found by what they are, not by when they were issued.
        return sanitizeFileName('$typeLabel Copy');
      case DocCategory.other:
        final heading = _heading(lines);
        if (heading != null) return sanitizeFileName('$heading $monthYear');
        return sanitizeFileName('Scan ${formatTimestamp(scannedAt)}');
      case DocCategory.bill:
        // "Electric Bill Oct 2026" already says what it is; only a generic
        // bill needs the company name to be recognisable.
        final name = typeLabel == category.label && vendor != null
            ? '$vendor $typeLabel'
            : typeLabel;
        return sanitizeFileName('$name $monthYear');
      default:
        final name = vendor == null ? typeLabel : '$vendor $typeLabel';
        return sanitizeFileName('$name $monthYear');
    }
  }

  /// First line that reads like a heading, for documents of unknown type.
  String? _heading(List<String> lines) {
    for (final line in lines.take(8)) {
      final letters = RegExp(r'[A-Za-z]').allMatches(line).length;
      if (letters < 4 || letters < line.length * 0.6) continue;
      final words = line
          .split(RegExp(r'\s+'))
          .where((w) => w.isNotEmpty)
          .take(5)
          .map(_titleCase)
          .join(' ');
      return words.length > 40 ? words.substring(0, 40).trim() : words;
    }
    return null;
  }
}

const _monthNames = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/// "Nov 2026"
String formatMonthYear(DateTime d) => '${_monthNames[d.month - 1]} ${d.year}';

/// "Nov 5, 2026"
String formatDate(DateTime d) =>
    '${_monthNames[d.month - 1]} ${d.day}, ${d.year}';

/// "2026-11-05 14.32" — sortable and safe in file names.
String formatTimestamp(DateTime d) {
  String two(int n) => n.toString().padLeft(2, '0');
  return '${d.year}-${two(d.month)}-${two(d.day)} '
      '${two(d.hour)}.${two(d.minute)}';
}
