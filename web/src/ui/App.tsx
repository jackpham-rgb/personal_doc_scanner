import { useEffect, useMemo, useState } from 'preact/hooks';
import { AppModel } from '../model';
import { CvClient } from '../scanner/cv-client';
import { DocView } from './DocView';
import { useRoute } from './hooks';
import { Library } from './Library';
import { Scanner } from './Scanner';
import { SettingsView } from './SettingsView';

export function App() {
  const [model, setModel] = useState<AppModel>();
  const [error, setError] = useState<string>();
  const route = useRoute();
  // Start loading the scanner engine straight away, so it is ready by the
  // time the user opens the camera.
  const cv = useMemo(() => new CvClient(), []);

  useEffect(() => {
    AppModel.create().then(setModel, (e: Error) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div class="empty">
        <h2>Could not open the document library</h2>
        <p>{error}</p>
      </div>
    );
  }
  if (!model) return <div class="empty"><span class="spinner" role="status" aria-label="Loading" /></div>;

  const doc = /^\/doc\/(\d+)$/.exec(route);
  if (route === '/scan') return <Scanner model={model} cv={cv} />;
  if (route === '/settings') return <SettingsView model={model} />;
  if (doc) return <DocView model={model} id={Number(doc[1])} />;
  return <Library model={model} />;
}
