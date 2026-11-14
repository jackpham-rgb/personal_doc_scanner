import { useEffect, useRef, useState } from 'preact/hooks';
import { decode, pixelsOf, pixelsToJpeg, toCanvas, toJpeg } from '../image';
import type { AppModel } from '../model';
import { warmUpOcr } from '../ocr';
import type { CvClient } from '../scanner/cv-client';
import { fullQuad, insetQuad, quadArea, quadDrift, scaleQuad } from '../scanner/geometry';
import type { Point, Quad } from '../types';
import { goBack } from './hooks';
import {
  CheckIcon,
  CloseIcon,
  CropIcon,
  FlashIcon,
  ImageIcon,
  PlusIcon,
  SparkleIcon,
  TrashIcon,
} from './icons';

/** Longest side of a frame handed to the scanner; larger ones are scaled. */
const MAX_SOURCE_SIDE = 4096;
/** Longest side of a saved page: about 200 dpi for a letter page. */
const MAX_PAGE_SIDE = 2400;
/** Frames are analysed at this size: enough to find a page, and fast. */
const DETECT_SIDE = 360;
/** How long the outline must hold still before the page captures itself. */
const STEADY_MS = 800;
/** Corner movement, as a share of the frame diagonal, that counts as still. */
const STEADY_DRIFT = 0.025;
/** A page smaller than this share of the frame is too far away to read. */
const MIN_CAPTURE_AREA = 0.2;

type Enhance = 'auto' | 'on' | 'off';

interface Page {
  /** The whole camera frame or photo, kept so the corners can be adjusted. */
  source: Blob;
  width: number;
  height: number;
  /** Corners of the page in `source` pixels. */
  quad: Quad;
  enhanced: boolean;
  /** The straightened page. */
  flat: Blob;
  url: string;
}

async function makePage(
  cv: CvClient,
  frame: HTMLCanvasElement,
  quad: Quad,
  enhance: Enhance,
  source?: Blob,
): Promise<Page> {
  const { image, enhanced } = await cv.flatten(pixelsOf(frame), quad, {
    maxSide: MAX_PAGE_SIDE,
    enhance,
  });
  const flat = await pixelsToJpeg(image);
  return {
    source: source ?? (await toJpeg(frame, 0.92)),
    width: frame.width,
    height: frame.height,
    quad,
    enhanced,
    flat,
    url: URL.createObjectURL(flat),
  };
}

/** Share of the page trimmed off a detected outline, to keep the desk out. */
const TRIM = 0.01;
/**
 * Size at which the outline is found again for the picture that is kept.
 * The live preview works at a lower size to keep up with the camera; this
 * pins the edges down to a few pixels of the full-size photo.
 */
const PRECISE_SIDE = 1200;

/** Finds the page in a full-size frame; null if there is none. */
async function detectIn(cv: CvClient, frame: HTMLCanvasElement): Promise<Quad | null> {
  const small = toCanvas(frame, PRECISE_SIDE);
  const quad = await cv.detect(pixelsOf(small));
  return quad && insetQuad(scaleQuad(quad, frame.width / small.width, frame.height / small.height), TRIM);
}

const points = (q: Quad) => q.map((p) => `${p.x},${p.y}`).join(' ');

export function Scanner({ model, cv }: { model: AppModel; cv: CvClient }) {
  const video = useRef<HTMLVideoElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<'camera' | 'review' | 'adjust'>('camera');
  const [pages, setPages] = useState<Page[]>([]);
  const [current, setCurrent] = useState(0);
  const [camera, setCamera] = useState<'starting' | 'live' | 'unavailable'>('starting');
  const [engineReady, setEngineReady] = useState(false);
  const [error, setError] = useState<string>();
  const [quad, setQuad] = useState<Quad | null>(null);
  const [steady, setSteady] = useState(0);
  const [tooFar, setTooFar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(false);
  const [torch, setTorch] = useState<boolean>();

  // Mirrors of state for the detection loop, which outlives single renders.
  const busyRef = useRef(false);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  /**
   * Outline of the page captured last. Auto-capture waits until the view has
   * changed from it, so "add page" does not capture the same page again.
   */
  const captured = useRef<Quad | null>(null);

  useEffect(() => {
    warmUpOcr();
    cv.ready.then(
      () => setEngineReady(true),
      (e: Error) => setError(e.message),
    );
  }, [cv]);

  // Camera stream: opened when the scanner appears, released when it goes.
  useEffect(() => {
    let stream: MediaStream | undefined;
    let cancelled = false;
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          // The highest resolution the camera offers: it decides how sharp
          // the text in the scan is.
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        const el = video.current!;
        el.srcObject = stream;
        await el.play();
        const [track] = stream.getVideoTracks();
        const caps = track.getCapabilities?.() as { torch?: boolean } | undefined;
        if (caps?.torch) setTorch(false);
        setCamera('live');
      } catch {
        if (!cancelled) setCamera('unavailable');
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Release page previews when the scanner closes.
  useEffect(() => () => pagesRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  const run = async (work: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const addPages = (added: Page[]) => {
    setCurrent(pagesRef.current.length + added.length - 1);
    setPages((p) => [...p, ...added]);
    setMode('review');
  };

  /** Captures the current camera frame. [outline] is in video pixels. */
  const capture = (outline: Quad | null) =>
    run(async () => {
      const el = video.current!;
      const frame = toCanvas(el, MAX_SOURCE_SIDE);
      setFlash(true);
      setTimeout(() => setFlash(false), 180);
      const found =
        (await detectIn(cv, frame)) ??
        (outline && insetQuad(scaleQuad(outline, frame.width / el.videoWidth), TRIM));
      captured.current = outline;
      addPages([await makePage(cv, frame, found ?? fullQuad(frame.width, frame.height), 'auto')]);
    });

  // Detection loop: outline the page in the preview and capture it once it
  // is held still.
  useEffect(() => {
    if (mode !== 'camera' || camera !== 'live' || !engineReady) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let last: Quad | null = null;
    let steadySince = 0;

    const tick = async () => {
      const el = video.current;
      if (stopped || !el) return;
      if (!busyRef.current && el.videoWidth > 0) {
        const small = toCanvas(el, DETECT_SIDE);
        const diagonal = Math.hypot(small.width, small.height);
        let found: Quad | null = null;
        try {
          found = await cv.detect(pixelsOf(small));
        } catch {
          // A dropped frame is not worth reporting; the next one follows.
        }
        if (stopped) return;

        const now = performance.now();
        const far = !!found && quadArea(found) < small.width * small.height * MIN_CAPTURE_AREA;
        if (!found || far || !last || quadDrift(found, last) > diagonal * STEADY_DRIFT) {
          steadySince = now;
        }
        if (captured.current && (!found || quadDrift(found, scaleQuad(captured.current, small.width / el.videoWidth)) > diagonal * 0.12)) {
          captured.current = null;
        }
        last = found;
        const armed = model.settings.autoCapture && !captured.current;
        const progress = found && !far && armed ? Math.min(1, (now - steadySince) / STEADY_MS) : 0;
        const outline = found && scaleQuad(found, el.videoWidth / small.width);
        setQuad(outline);
        setTooFar(far);
        setSteady(progress);
        if (progress >= 1 && outline) {
          steadySince = now;
          void capture(outline);
        }
      }
      timer = setTimeout(tick, 70);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
      setQuad(null);
      setSteady(0);
    };
  }, [mode, camera, engineReady, cv, model]);

  const importFiles = (files: File[]) =>
    run(async () => {
      await cv.ready;
      const added: Page[] = [];
      for (const file of files) {
        const frame = await decode(file, MAX_SOURCE_SIDE);
        const found = await detectIn(cv, frame);
        added.push(await makePage(cv, frame, found ?? fullQuad(frame.width, frame.height), 'auto'));
      }
      if (added.length) addPages(added);
    });

  /** Re-cuts the page shown in review with new corners or enhancement. */
  const redo = (corners: Quad, enhance: Enhance) =>
    run(async () => {
      const page = pages[current];
      const frame = await decode(page.source);
      const next = await makePage(cv, frame, corners, enhance, page.source);
      URL.revokeObjectURL(page.url);
      setPages((all) => all.map((p, i) => (i === current ? next : p)));
      setMode('review');
    });

  const removeCurrent = () => {
    URL.revokeObjectURL(pages[current].url);
    const rest = pages.filter((_, i) => i !== current);
    setPages(rest);
    setCurrent(Math.max(0, Math.min(current, rest.length - 1)));
    if (rest.length === 0 || camera === 'live') setMode('camera');
  };

  const close = () => {
    if (pages.length && !confirm(`Discard ${pages.length === 1 ? 'this page' : `these ${pages.length} pages`}?`)) {
      return;
    }
    goBack();
  };

  const save = () => {
    model.saveScan(pages.map((p) => p.flat));
    goBack();
  };

  const toggleTorch = async () => {
    const track = (video.current?.srcObject as MediaStream | null)?.getVideoTracks()[0];
    try {
      await track?.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(!torch);
    } catch {
      setTorch(undefined);
    }
  };

  const hint =
    camera === 'starting'
      ? 'Starting camera…'
      : !engineReady
        ? 'Loading scanner…'
        : busy
          ? 'Capturing…'
          : !quad
            ? 'Point the camera at a document'
            : tooFar
              ? 'Move closer'
              : !model.settings.autoCapture || captured.current
                ? 'Tap the button to capture'
                : 'Hold steady…';

  const page = pages[current];

  return (
    <div class="scanner">
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const input = e.currentTarget;
          void importFiles([...(input.files ?? [])]);
          input.value = '';
        }}
      />

      {/* The video stays mounted in every mode so the camera keeps running. */}
      <div class="camera" hidden={mode !== 'camera'}>
        <video ref={video} playsInline muted />
        {quad && video.current && (
          <svg
            class={`outline ${steady >= 1 ? 'locked' : ''}`}
            viewBox={`0 0 ${video.current.videoWidth} ${video.current.videoHeight}`}
            preserveAspectRatio="xMidYMid slice"
          >
            <polygon points={points(quad)} />
          </svg>
        )}
        {flash && <div class="flash" />}

        <div class="scanner-top">
          <button class="round" onClick={close} aria-label="Close scanner">
            <CloseIcon />
          </button>
          {torch !== undefined && (
            <button class={`round ${torch ? 'on' : ''}`} onClick={toggleTorch} aria-label="Flashlight" aria-pressed={torch}>
              <FlashIcon />
            </button>
          )}
        </div>

        {camera === 'unavailable' ? (
          <div class="camera-message">
            <p>The camera is not available. Allow camera access for this site, or use photos you already have.</p>
            <button class="primary" onClick={() => fileInput.current!.click()}>
              Choose photos
            </button>
          </div>
        ) : (
          <div class="hint" role="status">
            {error ?? hint}
          </div>
        )}

        <div class="scanner-bottom">
          <button class="round" onClick={() => fileInput.current!.click()} aria-label="Import photos">
            <ImageIcon />
          </button>
          <button
            class="shutter"
            style={{ '--steady': steady }}
            disabled={camera !== 'live' || !engineReady || busy}
            onClick={() => void capture(quad)}
            aria-label="Capture"
          />
          {pages.length > 0 ? (
            <button class="round count" onClick={() => setMode('review')} aria-label={`Review ${pages.length} pages`}>
              {pages.length}
            </button>
          ) : (
            <span class="round placeholder" />
          )}
        </div>
      </div>

      {mode === 'review' && page && (
        <div class="review">
          <div class="scanner-top">
            <button class="round" onClick={close} aria-label="Close scanner">
              <CloseIcon />
            </button>
            <span class="title">{pages.length > 1 ? `Page ${current + 1} of ${pages.length}` : 'Review'}</span>
            <span class="round placeholder" />
          </div>
          <div class="review-image">
            <img src={page.url} alt={`Scanned page ${current + 1}`} />
            {busy && <div class="working">Working…</div>}
          </div>
          {error && <div class="hint">{error}</div>}
          {pages.length > 1 && (
            <div class="strip">
              {pages.map((p, i) => (
                <button class={i === current ? 'selected' : ''} onClick={() => setCurrent(i)} aria-label={`Page ${i + 1}`}>
                  <img src={p.url} alt="" />
                </button>
              ))}
            </div>
          )}
          <div class="tools">
            <button onClick={removeCurrent} disabled={busy}>
              <TrashIcon />
              Retake
            </button>
            <button onClick={() => setMode('adjust')} disabled={busy}>
              <CropIcon />
              Corners
            </button>
            <button
              class={page.enhanced ? 'on' : ''}
              aria-pressed={page.enhanced}
              onClick={() => void redo(page.quad, page.enhanced ? 'off' : 'on')}
              disabled={busy}
            >
              <SparkleIcon />
              Enhance
            </button>
            <button onClick={() => setMode('camera')} disabled={busy}>
              <PlusIcon />
              Add page
            </button>
            <button class="primary" onClick={save} disabled={busy}>
              <CheckIcon />
              Save
            </button>
          </div>
        </div>
      )}

      {mode === 'adjust' && page && (
        <Corners
          page={page}
          busy={busy}
          onCancel={() => setMode('review')}
          onDone={(corners) => void redo(corners, page.enhanced ? 'on' : 'off')}
        />
      )}
    </div>
  );
}

/** Drag the four corners onto the corners of the page. */
function Corners(props: {
  page: Page;
  busy: boolean;
  onCancel: () => void;
  onDone: (quad: Quad) => void;
}) {
  const { page } = props;
  const svg = useRef<SVGSVGElement>(null);
  const [quad, setQuad] = useState<Quad>(page.quad);
  const [url, setUrl] = useState<string>();
  const dragging = useRef<number | undefined>(undefined);

  useEffect(() => {
    const made = URL.createObjectURL(page.source);
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [page.source]);

  /** Pointer position in image pixels. */
  const locate = (e: PointerEvent): Point => {
    const at = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse());
    return {
      x: Math.max(0, Math.min(page.width, at.x)),
      y: Math.max(0, Math.min(page.height, at.y)),
    };
  };

  const move = (e: PointerEvent) => {
    if (dragging.current === undefined) return;
    const at = locate(e);
    setQuad((q) => q.map((p, i) => (i === dragging.current ? at : p)) as Quad);
  };

  // Handles stay finger-sized whatever the image resolution.
  const r = Math.max(page.width, page.height) / 28;

  return (
    <div class="adjust">
      <div class="scanner-top">
        <button class="round" onClick={props.onCancel} aria-label="Cancel">
          <CloseIcon />
        </button>
        <span class="title">Drag the corners</span>
        <button class="round primary" onClick={() => props.onDone(quad)} disabled={props.busy} aria-label="Done">
          <CheckIcon />
        </button>
      </div>
      <svg
        ref={svg}
        class="adjust-area"
        viewBox={`0 0 ${page.width} ${page.height}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerMove={move}
        onPointerUp={() => (dragging.current = undefined)}
        onPointerCancel={() => (dragging.current = undefined)}
      >
        {url && <image href={url} width={page.width} height={page.height} />}
        <polygon points={points(quad)} stroke-width={r / 6} />
        {quad.map((p, i) => (
          <circle
            cx={p.x}
            cy={p.y}
            r={r}
            stroke-width={r / 5}
            data-corner={i}
            onPointerDown={(e) => {
              dragging.current = i;
              svg.current!.setPointerCapture(e.pointerId);
            }}
          />
        ))}
      </svg>
    </div>
  );
}
