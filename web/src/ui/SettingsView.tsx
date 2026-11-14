import { useEffect, useState } from 'preact/hooks';
import type { AppModel } from '../model';
import { DRIVE_ROOT_FOLDER } from '../sync/drive';
import { goBack, useModel } from './hooks';
import { BackIcon } from './icons';

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;

export function SettingsView({ model }: { model: AppModel }) {
  useModel(model);
  const { settings } = model;
  const [autoCapture, setAutoCapture] = useState(settings.autoCapture);
  const [clientId, setClientId] = useState(settings.driveClientId);
  const [connecting, setConnecting] = useState(false);
  const [driveError, setDriveError] = useState<string>();
  const [storage, setStorage] = useState<{ used?: number; kept?: boolean }>({});

  const refreshStorage = async () =>
    setStorage({
      used: (await navigator.storage?.estimate?.())?.usage,
      kept: await navigator.storage?.persisted?.(),
    });
  useEffect(() => void refreshStorage(), [model.docs.length]);

  const connect = async () => {
    settings.driveClientId = clientId;
    setConnecting(true);
    setDriveError(undefined);
    try {
      await model.connectDrive();
    } catch (e) {
      setDriveError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  };

  const connected = settings.driveEnabled;
  const syncError = model.sync.lastErrors[model.drive.id];

  return (
    <div class="screen">
      <header class="bar">
        <button class="icon" onClick={goBack} aria-label="Back">
          <BackIcon />
        </button>
        <h1>Settings</h1>
      </header>

      <section>
        <h2>Scanning</h2>
        <label class="switch">
          <span>
            Capture automatically
            <small>Take the picture as soon as a document is held steady</small>
          </span>
          <input
            type="checkbox"
            checked={autoCapture}
            onChange={(e) => {
              settings.autoCapture = e.currentTarget.checked;
              setAutoCapture(e.currentTarget.checked);
            }}
          />
        </label>
      </section>

      <section>
        <h2>Google Drive</h2>
        {connected ? (
          <>
            <p>
              {model.driveNeedsSignIn
                ? 'Sign-in has expired. Sign in again to keep uploading.'
                : (syncError ?? `Scans are uploaded to the “${DRIVE_ROOT_FOLDER}” folder in your Drive.`)}
            </p>
            {model.driveBacklog > 0 && (
              <p class="note">
                {model.driveBacklog === 1 ? '1 document is' : `${model.driveBacklog} documents are`} waiting to
                upload.
              </p>
            )}
            <div class="row">
              {model.driveNeedsSignIn ? (
                <button class="button primary" onClick={connect} disabled={connecting}>
                  Sign in again
                </button>
              ) : (
                <button class="button" onClick={() => void model.sync.sync()} disabled={model.sync.isSyncing}>
                  {model.sync.isSyncing ? 'Syncing…' : 'Sync now'}
                </button>
              )}
              <button class="button" onClick={() => void model.disconnectDrive()}>
                Disconnect
              </button>
            </div>
          </>
        ) : (
          <>
            <p>
              Upload every scan to your Drive so it appears on your laptop. This needs a Google OAuth client ID that
              you create once; the README has the steps. Register this address as an authorised JavaScript origin:
            </p>
            <p>
              <code>{location.origin}</code>
            </p>
            <label class="field">
              <span>OAuth client ID</span>
              <input
                type="text"
                inputMode="url"
                autocapitalize="off"
                spellcheck={false}
                placeholder="1234567890-abc.apps.googleusercontent.com"
                value={clientId}
                onInput={(e) => setClientId(e.currentTarget.value)}
              />
            </label>
            <button class="button primary" onClick={connect} disabled={connecting || !clientId.trim()}>
              {connecting ? 'Connecting…' : 'Connect Google Drive'}
            </button>
          </>
        )}
        {driveError && <p class="note error">{driveError}</p>}
      </section>

      <section>
        <h2>Storage</h2>
        <p>
          {model.docs.length === 1 ? '1 document' : `${model.docs.length} documents`}
          , kept in this browser on this device.
          {storage.used !== undefined &&
            ` The app uses ${megabytes(storage.used)} in all, including its scanner and text-reading engines.`}
        </p>
        {storage.kept === false && (
          <>
            <p class="note">
              The browser may clear this site's data if the device runs low on space. Connect Google Drive so every
              scan has a copy elsewhere.
            </p>
            <button
              class="button"
              onClick={async () => {
                await navigator.storage.persist();
                await refreshStorage();
              }}
            >
              Ask the browser to keep my documents
            </button>
          </>
        )}
        {storage.kept && <p class="note">The browser has agreed not to clear them automatically.</p>}
      </section>
    </div>
  );
}
