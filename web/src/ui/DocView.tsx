import { useEffect, useState } from 'preact/hooks';
import { formatDate, fromIsoDay } from '../analyzer';
import type { AppModel } from '../model';
import { pageKey, pdfKey } from '../store';
import { CATEGORIES, CATEGORY_IDS, type CategoryId, type DocRecord } from '../types';
import { goBack, useFileUrls, useModel } from './hooks';
import { BackIcon, DownloadIcon, EditIcon, ShareIcon, TextIcon, TrashIcon } from './icons';

/** One document: its pages, what was read from it, and where it is synced. */
export function DocView({ model, id }: { model: AppModel; id: number }) {
  useModel(model);
  const doc = model.docs.find((d) => d.id === id);
  const pages = useFileUrls(
    model,
    doc ? Array.from({ length: doc.pageCount }, (_, i) => pageKey(id, i)) : [],
  );
  const [pdfUrl] = useFileUrls(model, doc ? [pdfKey(id)] : []);
  const [showText, setShowText] = useState(false);
  const [error, setError] = useState<string>();

  // Leave the screen once the document is gone (deleted here or elsewhere).
  useEffect(() => {
    if (!doc) goBack();
  }, [doc]);
  if (!doc) return null;

  const fileName = `${doc.title}.pdf`;
  const attempt = (work: () => Promise<unknown>) =>
    work().catch((e: Error) => {
      // Dismissing the share sheet is not an error worth showing.
      if (e.name !== 'AbortError') setError(e.message);
    });

  const pdfFile = async () => new File([(await model.store.file(pdfKey(id)))!], fileName, { type: 'application/pdf' });
  const canShare = typeof navigator.canShare === 'function';

  const rename = () => {
    const title = prompt('Name', doc.title);
    if (title?.trim()) void attempt(() => model.edit(doc, { title }));
  };

  const remove = () => {
    const where = model.settings.driveEnabled ? 'this device and from Google Drive' : 'this device';
    if (confirm(`Delete “${doc.title}” from ${where}?`)) void attempt(() => model.remove(doc));
  };

  return (
    <div class="screen">
      <header class="bar">
        <button class="icon" onClick={goBack} aria-label="Back">
          <BackIcon />
        </button>
        <h1 class="small">{doc.title}</h1>
        <button class="icon" onClick={rename} aria-label="Rename">
          <EditIcon />
        </button>
        <button class="icon" onClick={remove} aria-label="Delete">
          <TrashIcon />
        </button>
      </header>

      <div class="pages">
        {pages.map((url, i) => url && <img src={url} alt={`Page ${i + 1}`} />)}
      </div>
      {doc.pageCount > 1 && <p class="note">{doc.pageCount} pages — swipe to see them</p>}

      <div class="actions">
        <a class="button primary" href={pdfUrl} target="_blank" rel="noopener">
          Open PDF
        </a>
        {canShare && (
          <button
            class="button"
            onClick={() =>
              attempt(async () => {
                const file = await pdfFile();
                if (!navigator.canShare({ files: [file] })) throw new Error('This browser cannot share files.');
                await navigator.share({ files: [file], title: doc.title });
              })
            }
          >
            <ShareIcon />
            Share
          </button>
        )}
        <a class="button" href={pdfUrl} download={fileName}>
          <DownloadIcon />
          Download
        </a>
      </div>
      {error && <p class="note error">{error}</p>}

      <dl class="details">
        <div>
          <dt>Folder</dt>
          <dd>
            <select
              value={doc.category}
              aria-label="Folder"
              onChange={(e) => void attempt(() => model.edit(doc, { category: e.currentTarget.value as CategoryId }))}
            >
              {CATEGORY_IDS.map((c) => (
                <option value={c}>{CATEGORIES[c].folder}</option>
              ))}
            </select>
          </dd>
        </div>
        {doc.vendor && <Detail label="From" value={doc.vendor} />}
        {doc.docDate && <Detail label="Date on document" value={formatDate(fromIsoDay(doc.docDate))} />}
        {doc.amount !== undefined && <Detail label="Total" value={`$${doc.amount.toFixed(2)}`} />}
        <Detail label="Scanned" value={formatDate(new Date(doc.createdAt))} />
        {model.settings.driveEnabled && <Detail label="Google Drive" value={syncText(doc, model.drive.id)} />}
      </dl>

      <button class="button wide" onClick={() => setShowText(!showText)} aria-expanded={showText}>
        <TextIcon />
        {showText ? 'Hide text' : 'Show text in this document'}
      </button>
      {showText && <pre class="ocr-text">{doc.text || 'No text was found in this document.'}</pre>}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function syncText(doc: DocRecord, target: string): string {
  const state = doc.sync[target];
  if (state?.status === 'synced') return 'Synced';
  if (state?.status === 'error') return `Failed: ${state.error ?? 'unknown error'}`;
  return 'Waiting to sync';
}
