import { CATEGORIES, type CategoryId, sanitizeFileName } from './types';

/** What the analyzer worked out about a document from its recognised text. */
export interface Analysis {
  category: CategoryId;
  /** Specific type used in the title, e.g. "Electric Bill" or "Passport". */
  typeLabel: string;
  title: string;
  vendor?: string;
  date?: Date;
  amount?: number;
}

const MONEY_CATEGORIES = new Set<CategoryId>(['receipt', 'invoice', 'bill']);
const HEADER_VENDOR_CATEGORIES = new Set<CategoryId>(['receipt', 'invoice']);

/**
 * Keyword → weight per category. A phrase counts once however often it
 * appears, so one very repetitive document cannot swamp the score.
 */
const KEYWORDS: Partial<Record<CategoryId, Record<string, number>>> = {
  receipt: {
    receipt: 4,
    subtotal: 3,
    'sub total': 3,
    'change due': 3,
    cashier: 3,
    'items sold': 3,
    'thank you for shopping': 4,
    'thank you for your purchase': 3,
    approved: 1,
    visa: 1,
    mastercard: 1,
    debit: 1,
    'sales tax': 2,
    total: 1,
    cash: 1,
    tender: 2,
    'store #': 2,
    register: 1,
    'refund policy': 2,
  },
  invoice: {
    invoice: 5,
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
  bill: {
    electric: 3,
    electricity: 3,
    kwh: 4,
    therms: 4,
    utility: 3,
    utilities: 3,
    'water service': 3,
    sewer: 3,
    'billing period': 3,
    'service address': 3,
    'amount due': 2,
    'meter reading': 4,
    'meter number': 3,
    'internet service': 3,
    wireless: 2,
    'data plan': 2,
    'monthly charges': 2,
    'previous balance': 2,
    'payment due': 2,
    'late fee': 1,
    'account number': 1,
  },
  bankStatement: {
    'statement period': 3,
    'beginning balance': 4,
    'ending balance': 4,
    'opening balance': 3,
    'closing balance': 3,
    'account summary': 2,
    deposits: 2,
    withdrawals: 3,
    checking: 2,
    savings: 2,
    'routing number': 2,
    'member fdic': 3,
    'credit limit': 2,
    'minimum payment': 2,
    transactions: 1,
  },
  id: {
    passport: 6,
    passeport: 4,
    'driver license': 6,
    "driver's license": 6,
    'drivers license': 6,
    'driving licence': 6,
    'identification card': 5,
    'identity card': 5,
    'date of birth': 3,
    nationality: 3,
    'place of birth': 3,
    'social security': 5,
    'permanent resident': 5,
    'birth certificate': 6,
    'certificate of birth': 6,
    'student id': 4,
    'date of expiry': 2,
    'date of issue': 2,
  },
  insurance: {
    insurance: 4,
    'policy number': 4,
    'policy no': 3,
    policyholder: 4,
    'policy period': 3,
    coverage: 2,
    coverages: 2,
    premium: 3,
    deductible: 3,
    insured: 3,
    liability: 2,
    declarations: 2,
    claim: 1,
    underwriter: 2,
    naic: 3,
  },
  tax: {
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
  medical: {
    patient: 3,
    diagnosis: 4,
    prescription: 4,
    physician: 3,
    clinic: 2,
    hospital: 2,
    'medical record': 5,
    'lab results': 4,
    laboratory: 2,
    immunization: 4,
    vaccine: 3,
    vaccination: 3,
    'explanation of benefits': 4,
    'date of service': 3,
    provider: 1,
    dosage: 3,
    refills: 3,
    pharmacy: 2,
  },
  contract: {
    agreement: 3,
    lease: 3,
    landlord: 4,
    tenant: 4,
    hereby: 3,
    hereinafter: 4,
    'the parties': 3,
    'terms and conditions': 2,
    'in witness whereof': 5,
    'governing law': 4,
    shall: 1,
    contract: 3,
    lessee: 4,
    lessor: 4,
    'effective date': 2,
  },
  letter: {
    'dear ': 3,
    sincerely: 4,
    'best regards': 3,
    'kind regards': 3,
    'yours truly': 4,
    'yours faithfully': 4,
    'to whom it may concern': 5,
    're:': 1,
  },
};

const MIN_SCORE = 4;

const isWordChar = (c: string | undefined) => c !== undefined && /[0-9a-z]/.test(c);

/**
 * Index of [phrase] in [lower] as a whole phrase: where the phrase starts or
 * ends with a letter or digit, the neighbouring character must not be one,
 * so "rx" does not match inside "marxism". Returns -1 if absent.
 */
function indexOfPhrase(lower: string, phrase: string): number {
  let from = 0;
  for (;;) {
    const i = lower.indexOf(phrase, from);
    if (i < 0) return -1;
    const end = i + phrase.length;
    const startOk = !isWordChar(phrase[0]) || i === 0 || !isWordChar(lower[i - 1]);
    const endOk =
      !isWordChar(phrase[phrase.length - 1]) || end >= lower.length || !isWordChar(lower[end]);
    if (startOk && endOk) return i;
    from = i + 1;
  }
}

function classify(lower: string): CategoryId {
  // Machine-readable zone of a passport.
  if (/p<[a-z]{3}[a-z<]{5,}/.test(lower)) return 'id';

  let best: CategoryId = 'other';
  let bestScore = 0;
  for (const [category, words] of Object.entries(KEYWORDS) as [
    CategoryId,
    Record<string, number>,
  ][]) {
    let score = 0;
    for (const [word, weight] of Object.entries(words)) {
      if (indexOfPhrase(lower, word) >= 0) score += weight;
    }
    if (score > bestScore) {
      bestScore = score;
      best = category;
    }
  }
  return bestScore >= MIN_SCORE ? best : 'other';
}

/** Ordered most-specific first. */
const SUBTYPES: Partial<Record<CategoryId, [string, string][]>> = {
  id: [
    ['passport', 'Passport'],
    ['p<', 'Passport'],
    ["driver's license", 'Driver License'],
    ['driver license', 'Driver License'],
    ['drivers license', 'Driver License'],
    ['driving licence', 'Driver License'],
    ['social security', 'Social Security Card'],
    ['permanent resident', 'Green Card'],
    ['birth certificate', 'Birth Certificate'],
    ['certificate of birth', 'Birth Certificate'],
    ['student id', 'Student ID'],
  ],
  bill: [
    ['kwh', 'Electric Bill'],
    ['electric', 'Electric Bill'],
    ['therms', 'Gas Bill'],
    ['natural gas', 'Gas Bill'],
    ['sewer', 'Water Bill'],
    ['water', 'Water Bill'],
    ['internet', 'Internet Bill'],
    ['broadband', 'Internet Bill'],
    ['wireless', 'Phone Bill'],
    ['mobile', 'Phone Bill'],
    ['phone', 'Phone Bill'],
    ['garbage', 'Trash Bill'],
    ['waste', 'Trash Bill'],
  ],
  insurance: [
    ['auto insurance', 'Car Insurance'],
    ['automobile', 'Car Insurance'],
    ['vehicle', 'Car Insurance'],
    ['renters', 'Renters Insurance'],
    ['homeowner', 'Home Insurance'],
    ['dental', 'Dental Insurance'],
    ['vision', 'Vision Insurance'],
    ['health', 'Health Insurance'],
    ['medical', 'Health Insurance'],
    ['life insurance', 'Life Insurance'],
  ],
  tax: [
    ['w-2', 'W-2'],
    ['wage and tax statement', 'W-2'],
    ['1099', '1099'],
    ['1098', '1098'],
    ['property tax', 'Property Tax'],
    ['1040', 'Tax Return'],
    ['tax return', 'Tax Return'],
  ],
  medical: [
    ['immunization', 'Immunization Record'],
    ['vaccin', 'Immunization Record'],
    ['prescription', 'Prescription'],
    ['lab results', 'Lab Results'],
    ['explanation of benefits', 'Explanation of Benefits'],
  ],
  contract: [
    ['lease', 'Lease'],
    ['rental agreement', 'Lease'],
    ['employment', 'Employment Contract'],
  ],
};

function typeLabel(category: CategoryId, lower: string): string {
  for (const [needle, label] of SUBTYPES[category] ?? []) {
    if (lower.includes(needle)) return label;
  }
  return CATEGORIES[category].label;
}

/**
 * Well-known names, matched case-insensitively as whole phrases. The key is
 * what to look for, the value is how to print it.
 */
const VENDORS: Record<string, string> = {
  costco: 'Costco',
  walmart: 'Walmart',
  'wal-mart': 'Walmart',
  target: 'Target',
  safeway: 'Safeway',
  "trader joe's": "Trader Joe's",
  'trader joes': "Trader Joe's",
  'whole foods': 'Whole Foods',
  kroger: 'Kroger',
  albertsons: 'Albertsons',
  aldi: 'Aldi',
  amazon: 'Amazon',
  'home depot': 'Home Depot',
  "lowe's": "Lowe's",
  ikea: 'IKEA',
  'best buy': 'Best Buy',
  cvs: 'CVS',
  walgreens: 'Walgreens',
  'rite aid': 'Rite Aid',
  starbucks: 'Starbucks',
  "mcdonald's": "McDonald's",
  chipotle: 'Chipotle',
  'apple store': 'Apple',
  shell: 'Shell',
  chevron: 'Chevron',
  '7-eleven': '7-Eleven',
  'pg&e': 'PG&E',
  'pacific gas and electric': 'PG&E',
  'con edison': 'Con Edison',
  'duke energy': 'Duke Energy',
  comcast: 'Comcast',
  xfinity: 'Xfinity',
  'at&t': 'AT&T',
  verizon: 'Verizon',
  't-mobile': 'T-Mobile',
  spectrum: 'Spectrum',
  geico: 'GEICO',
  'state farm': 'State Farm',
  allstate: 'Allstate',
  progressive: 'Progressive',
  'liberty mutual': 'Liberty Mutual',
  'farmers insurance': 'Farmers',
  usaa: 'USAA',
  aaa: 'AAA',
  'kaiser permanente': 'Kaiser',
  'blue cross': 'Blue Cross',
  'blue shield': 'Blue Shield',
  aetna: 'Aetna',
  cigna: 'Cigna',
  unitedhealthcare: 'UnitedHealthcare',
  chase: 'Chase',
  'bank of america': 'Bank of America',
  'wells fargo': 'Wells Fargo',
  citibank: 'Citi',
  'capital one': 'Capital One',
  'american express': 'American Express',
  discover: 'Discover',
  fedex: 'FedEx',
  'ups store': 'UPS',
  usps: 'USPS',
  uber: 'Uber',
  lyft: 'Lyft',
};

/** The known vendor that appears earliest in the text. */
function knownVendor(lower: string): string | undefined {
  let best: string | undefined;
  let bestIndex = lower.length;
  for (const [needle, display] of Object.entries(VENDORS)) {
    const i = indexOfPhrase(lower, needle);
    if (i >= 0 && i < bestIndex) {
      bestIndex = i;
      best = display;
    }
  }
  return best;
}

const GENERIC_HEADER =
  /^(receipt|invoice|tax invoice|sales receipt|customer copy|merchant copy|welcome|thank you|order|statement|bill|page \d+)\b/i;

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

function titleCase(word: string): string {
  if (word.length <= 3 && word === word.toUpperCase()) return word; // "IBM"
  return word[0].toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Shops print their name at the top of a receipt, so fall back to the first
 * line near the top that looks like a name rather than an address or date.
 */
function headerVendor(lines: string[]): string | undefined {
  for (const line of lines.slice(0, 6)) {
    const letters = count(line, /[A-Za-z]/g);
    const digits = count(line, /\d/g);
    if (letters < 3 || digits > 2) continue;
    if (letters < line.replace(/ /g, '').length * 0.7) continue;
    if (GENERIC_HEADER.test(line)) continue;
    const words = line
      .replace(/[^A-Za-z0-9&' -]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .map(titleCase)
      .join(' ');
    if (words.length >= 3) return words.length > 28 ? words.slice(0, 28).trim() : words;
  }
  return undefined;
}

// -------------------------------------------------------------------- date

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_PATTERN = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';

const NUMERIC_DATE = /(?<!\d)(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4}|\d{2})(?!\d)/g;
const ISO_DATE = /(?<!\d)(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})(?!\d)/g;
const MONTH_FIRST = new RegExp(
  `\\b${MONTH_PATTERN}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`,
  'gi',
);
const DAY_FIRST = new RegExp(
  `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_PATTERN},?\\s+(\\d{4})\\b`,
  'gi',
);
const DATE_HINT = /\bdate\b|\bdated\b/i;
const DATE_ANTI_HINT = /birth|\bdob\b|born|expir|\bexp\b|due|valid|until|issue|member since/i;
const FUTURE_SLACK_MS = 60 * 24 * 3600 * 1000;

const monthNumber = (name: string) => MONTHS.indexOf(name.toLowerCase().slice(0, 3)) + 1;
const fullYear = (y: string) => (y.length === 4 ? Number(y) : 2000 + Number(y));

function makeDate(year: number, month: number, day: number): Date | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const date = new Date(year, month - 1, day);
  // Date rolls 31 Feb over into March; reject instead.
  return date.getMonth() === month - 1 ? date : undefined;
}

/**
 * Picks the date that most likely says when the document was issued.
 *
 * Slash dates are read month-first (US style) unless that is impossible.
 */
function findDate(lines: string[], scannedAt: Date): Date | undefined {
  let best: Date | undefined;
  let bestScore = -1000;

  const consider = (date: Date | undefined, line: string) => {
    if (!date) return;
    // Documents are not dated far in the future or before most people were
    // keeping paperwork; such matches are OCR noise or other numbers.
    if (date.getFullYear() < 1990 || date.getTime() > scannedAt.getTime() + FUTURE_SLACK_MS) {
      return;
    }
    let score = 0;
    if (DATE_HINT.test(line)) score += 2;
    if (DATE_ANTI_HINT.test(line)) score -= 5;
    if (score > bestScore) {
      bestScore = score;
      best = date;
    }
  };

  for (const line of lines) {
    for (const m of line.matchAll(ISO_DATE)) {
      consider(makeDate(Number(m[1]), Number(m[2]), Number(m[3])), line);
    }
    for (const m of line.matchAll(NUMERIC_DATE)) {
      let month = Number(m[1]);
      let day = Number(m[2]);
      if (month > 12 && day <= 12) [month, day] = [day, month];
      consider(makeDate(fullYear(m[3]), month, day), line);
    }
    for (const m of line.matchAll(MONTH_FIRST)) {
      consider(makeDate(Number(m[3]), monthNumber(m[1]), Number(m[2])), line);
    }
    for (const m of line.matchAll(DAY_FIRST)) {
      consider(makeDate(Number(m[3]), monthNumber(m[2]), Number(m[1])), line);
    }
  }
  return best;
}

// ------------------------------------------------------------------ amount

const MONEY = /(?<![\d.,])\$?\s?(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})(?!\d)/g;

/** Label → priority. Higher wins; ties go to the larger amount. */
const TOTAL_LABELS: [RegExp, number][] = [
  [/grand\s+total/i, 5],
  [
    /(total\s+)?amount\s+due|balance\s+due|total\s+due|amount\s+paid|total\s+amount|please\s+pay/i,
    4,
  ],
  [/(?<!sub)(?<!sub )(?<!sub-)\btotal\b/i, 3],
  [/\bbalance\b|\bamount\b/i, 1],
];
const NOT_A_TOTAL =
  /sub\s?-?total|total\s+(savings|items|tax|discount|number|qty|points)|previous\s+balance|beginning\s+balance/i;

const amountsIn = (line: string) =>
  [...line.matchAll(MONEY)].map((m) => Number(`${m[1].replace(/,/g, '')}.${m[2]}`));

function findAmount(lines: string[]): number | undefined {
  let best: number | undefined;
  let bestPriority = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (NOT_A_TOTAL.test(line)) continue;
    const priority = TOTAL_LABELS.find(([pattern]) => pattern.test(line))?.[1] ?? 0;
    if (priority === 0) continue;

    // OCR often splits a row into a label line and a value line.
    let amounts = amountsIn(line);
    if (amounts.length === 0 && i + 1 < lines.length) amounts = amountsIn(lines[i + 1]);
    if (amounts.length === 0) continue;
    const amount = Math.max(...amounts);
    if (priority > bestPriority || (priority === bestPriority && amount > (best ?? 0))) {
      bestPriority = priority;
      best = amount;
    }
  }
  return best;
}

// ------------------------------------------------------------------- title

/** First line that reads like a heading, for documents of unknown type. */
function heading(lines: string[]): string | undefined {
  for (const line of lines.slice(0, 8)) {
    const letters = count(line, /[A-Za-z]/g);
    if (letters < 4 || letters < line.length * 0.6) continue;
    const words = line.split(/\s+/).filter(Boolean).slice(0, 5).map(titleCase).join(' ');
    return words.length > 40 ? words.slice(0, 40).trim() : words;
  }
  return undefined;
}

function buildTitle(a: Omit<Analysis, 'title'>, scannedAt: Date, lines: string[]): string {
  const monthYear = formatMonthYear(a.date ?? scannedAt);
  const generic = CATEGORIES[a.category].label;

  switch (a.category) {
    case 'id':
      // IDs are found by what they are, not by when they were issued.
      return sanitizeFileName(`${a.typeLabel} Copy`);
    case 'other': {
      const h = heading(lines);
      return sanitizeFileName(h ? `${h} ${monthYear}` : `Scan ${formatTimestamp(scannedAt)}`);
    }
    case 'bill': {
      // "Electric Bill Oct 2026" already says what it is; only a generic
      // bill needs the company name to be recognisable.
      const name = a.typeLabel === generic && a.vendor ? `${a.vendor} ${a.typeLabel}` : a.typeLabel;
      return sanitizeFileName(`${name} ${monthYear}`);
    }
    default: {
      const name = a.vendor ? `${a.vendor} ${a.typeLabel}` : a.typeLabel;
      return sanitizeFileName(`${name} ${monthYear}`);
    }
  }
}

/**
 * Rule-based document understanding: classifies recognised text, pulls out
 * the vendor, date and total, and proposes a file name. Runs entirely on the
 * device.
 */
export function analyze(text: string, scannedAt: Date): Analysis {
  const lower = text.toLowerCase();
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const category = classify(lower);
  const partial = {
    category,
    typeLabel: typeLabel(category, lower),
    date: findDate(lines, scannedAt),
    amount: MONEY_CATEGORIES.has(category) ? findAmount(lines) : undefined,
    vendor:
      knownVendor(lower) ?? (HEADER_VENDOR_CATEGORIES.has(category) ? headerVendor(lines) : undefined),
  };
  return { ...partial, title: buildTitle(partial, scannedAt, lines) };
}

const MONTH_NAMES = [
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

/** "Nov 2026" */
export const formatMonthYear = (d: Date) => `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;

/** "Nov 5, 2026" */
export const formatDate = (d: Date) =>
  `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;

/** "2026-11-05 14.32" — sortable and safe in file names. */
export function formatTimestamp(d: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}.${two(d.getMinutes())}`;
}

/** `yyyy-mm-dd` in local time, as stored on a document. */
export function toIsoDay(d: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/** Parses a stored `yyyy-mm-dd` as a local date. */
export function fromIsoDay(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
