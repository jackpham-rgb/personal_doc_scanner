import { useEffect, useReducer, useState } from 'preact/hooks';
import type { AppModel } from '../model';

/** Re-renders the component whenever the model or sync state changes. */
export function useModel(model: AppModel): void {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const offModel = model.subscribe(() => rerender(0));
    const offSync = model.sync.subscribe(() => rerender(0));
    return () => {
      offModel();
      offSync();
    };
  }, [model]);
}

/**
 * Loads stored files and exposes them as object URLs for `<img>` and links,
 * releasing the URLs when the component goes away.
 */
export function useFileUrls(model: AppModel, keys: string[]): (string | undefined)[] {
  const [urls, setUrls] = useState<(string | undefined)[]>([]);
  const signature = keys.join('|');
  useEffect(() => {
    let live = true;
    let made: (string | undefined)[] = [];
    void Promise.all(keys.map((k) => model.store.file(k))).then((blobs) => {
      made = blobs.map((b) => b && URL.createObjectURL(b));
      if (live) setUrls(made);
      else made.forEach((u) => u && URL.revokeObjectURL(u));
    });
    return () => {
      live = false;
      made.forEach((u) => u && URL.revokeObjectURL(u));
    };
  }, [model, signature]);
  return urls;
}

/** The part of the URL after `#`, e.g. "/doc/12". Changes on navigation. */
export function useRoute(): string {
  const read = () => location.hash.replace(/^#/, '') || '/';
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export const go = (route: string) => {
  location.hash = route;
};

/** Leaves the current screen: back in history if there is any, else home. */
export const goBack = () => {
  if (history.length > 1) history.back();
  else go('/');
};
