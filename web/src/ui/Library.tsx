import { formatDate, fromIsoDay } from '../analyzer';
import type { AppModel } from '../model';
import type { SearchHit } from '../search';
import { thumbKey } from '../store';
import { CATEGORIES, CATEGORY_IDS } from '../types';
import { go, useFileUrls, useModel } from './hooks';
import { CloseIcon, CloudDoneIcon, CloudUpIcon, ScanIcon, SearchIcon, SettingsIcon } from './icons';

/**
 * The library: a search box over everything that has been scanned, and the
 * button that starts a scan.
 */
export function Library({ model }: { model: AppModel }) {
  useModel(model);
  const hits = model.hits;
  const counts = model.categoryCounts();
  const searching = model.query.trim() !== '' || model.category !== undefined;
  const thumbs = useFileUrls(
    model,
    hits.map((h) => thumbKey(h.doc.id)),
  );

  return (
    <div class="screen">
      <header class="bar">
        <h1>Documents</h1>
        {model.sync.isSyncing && <span class="spinner" role="status" aria-label="Syncing" />}
        <button class="icon" onClick={() => go('/settings')} aria-label="Settings">
          <SettingsIcon />
        </button>
      </header>

      <label class="search">
        <SearchIcon />
        <input
          type="search"
          placeholder="Search inside your documents"
          value={model.query}
          onInput={(e) => model.setQuery(e.currentTarget.value)}
        />
        {model.query && (
          <button class="icon" onClick={() => model.setQuery('')} aria-label="Clear search">
            <CloseIcon />
          </button>
        )}
      </label>

      {counts.size > 1 && (
        <div class="chips">
          <button class={model.category ? '' : 'selected'} onClick={() => model.setCategory(undefined)}>
            All
          </button>
          {CATEGORY_IDS.filter((c) => counts.has(c)).map((c) => (
            <button
              class={model.category === c ? 'selected' : ''}
              onClick={() => model.setCategory(model.category === c ? undefined : c)}
            >
              {CATEGORIES[c].folder} {counts.get(c)}
            </button>
          ))}
        </div>
      )}

      {model.processing && (
        <div class="banner" role="status">
          <span>{model.processing}</span>
          <div class="progress" />
        </div>
      )}

      {model.driveNeedsSignIn && model.driveBacklog > 0 && (
        <button
          class="banner action"
          onClick={() => model.connectDrive().catch((e: Error) => alert(e.message))}
        >
          Google Drive sign-in has expired. Tap to sign in and upload{' '}
          {model.driveBacklog === 1 ? '1 document' : `${model.driveBacklog} documents`}.
        </button>
      )}

      {hits.length === 0 ? (
        <div class="empty">
          <ScanIcon width="56" height="56" />
          <h2>{searching ? 'No documents match' : 'No documents yet'}</h2>
          <p>
            {searching
              ? 'Try a different word, a company name or a month.'
              : 'Tap Scan and point the camera at a document. It is cropped, read, named and filed for you.'}
          </p>
        </div>
      ) : (
        <ul class="docs">
          {hits.map((hit, i) => (
            <Row model={model} hit={hit} thumb={thumbs[i]} />
          ))}
        </ul>
      )}

      {model.notice && (
        <div class="toast" role="status">
          <span>{model.notice.text}</span>
          {model.notice.docId !== undefined && (
            <button
              onClick={() => {
                const id = model.notice!.docId;
                model.dismissNotice();
                go(`/doc/${id}`);
              }}
            >
              View
            </button>
          )}
          <button class="icon" onClick={() => model.dismissNotice()} aria-label="Dismiss">
            <CloseIcon />
          </button>
        </div>
      )}

      <button class="fab" onClick={() => go('/scan')} disabled={!!model.processing}>
        <ScanIcon />
        Scan
      </button>
    </div>
  );
}

function Row({ model, hit, thumb }: { model: AppModel; hit: SearchHit; thumb?: string }) {
  const { doc, snippet } = hit;
  const details = [
    CATEGORIES[doc.category].folder,
    formatDate(doc.docDate ? fromIsoDay(doc.docDate) : new Date(doc.createdAt)),
    doc.amount !== undefined && `$${doc.amount.toFixed(2)}`,
  ]
    .filter(Boolean)
    .join(' · ');
  const synced = doc.sync[model.drive.id]?.status === 'synced';

  return (
    <li>
      <a href={`#/doc/${doc.id}`}>
        <span class="thumb">{thumb ? <img src={thumb} alt="" /> : CATEGORIES[doc.category].icon}</span>
        <span class="text">
          <strong>{doc.title}</strong>
          <small>{details}</small>
          {snippet && <small class="snippet">{snippet}</small>}
        </span>
        {model.settings.driveEnabled &&
          (synced ? (
            <CloudDoneIcon class="sync" aria-label="Synced" aria-hidden={false} />
          ) : (
            <CloudUpIcon class="sync" aria-label="Waiting to sync" aria-hidden={false} />
          ))}
      </a>
    </li>
  );
}
