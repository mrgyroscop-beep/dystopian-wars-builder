import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  type CSSProperties,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

interface PdfDocumentViewerProps {
  readonly source: string;
  readonly title: string;
}

interface ScrollState {
  readonly currentPage: number;
  readonly progress: number;
  readonly thumbSize: number;
}

const initialScrollState: ScrollState = {
  currentPage: 1,
  progress: 0,
  thumbSize: 100,
};

export function PdfDocumentViewer({ source, title }: PdfDocumentViewerProps) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scrollState, setScrollState] = useState(initialScrollState);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let loadingTask: PDFDocumentLoadingTask | undefined;

    async function loadDocument() {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        loadingTask = pdfjs.getDocument({ url: source });
        const loadedDocument = await loadingTask.promise;
        if (disposed) return;
        setDocument(loadedDocument);
      } catch {
        if (!disposed) setError("Не удалось загрузить PDF. Попробуйте открыть документ заново.");
      }
    }

    void loadDocument();

    return () => {
      disposed = true;
      if (loadingTask) void loadingTask.destroy();
    };
  }, [source]);

  const updateScrollState = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller || !document) return;

    const maximumScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const progress = maximumScroll ? scroller.scrollTop / maximumScroll : 0;
    const viewportRatio = scroller.scrollHeight ? scroller.clientHeight / scroller.scrollHeight : 1;
    const pageElements = scroller.querySelectorAll<HTMLElement>("[data-pdf-page]");
    const viewportMiddle = scroller.scrollTop + scroller.clientHeight / 2;
    let currentPage = 1;

    for (const pageElement of pageElements) {
      currentPage = Number(pageElement.dataset.pdfPage ?? currentPage);
      if (pageElement.offsetTop + pageElement.offsetHeight >= viewportMiddle) break;
    }

    setScrollState({
      currentPage,
      progress,
      thumbSize: Math.max(8, Math.min(100, viewportRatio * 100)),
    });
  }, [document]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !document) return;

    updateScrollState();
    const resizeObserver = new ResizeObserver(updateScrollState);
    resizeObserver.observe(scroller);
    return () => resizeObserver.disconnect();
  }, [document, updateScrollState]);

  const thumbTravel = 100 - scrollState.thumbSize;
  const indicatorStyle = {
    "--pdf-scroll-progress": `${scrollState.progress * thumbTravel}%`,
    "--pdf-scroll-size": `${scrollState.thumbSize}%`,
  } as CSSProperties;

  return (
    <div className="reference-pdf" data-source={source} role="region" aria-label={title}>
      <div className="reference-pdf__toolbar" aria-live="polite">
        <span>
          {document ? `${scrollState.currentPage} / ${document.numPages}` : "Загрузка PDF…"}
        </span>
        <small>Листайте документ внутри окна</small>
      </div>
      <div className="reference-pdf__viewport">
        {error ? (
          <div className="reference-pdf__message" role="alert">
            {error}
          </div>
        ) : (
          <div
            className="reference-pdf__scroll"
            onScroll={updateScrollState}
            ref={scrollRef}
            role="region"
            aria-label={`Страницы документа «${title}»`}
          >
            {document
              ? Array.from({ length: document.numPages }, (_, index) => (
                  <PdfPage
                    document={document}
                    key={index + 1}
                    number={index + 1}
                    onLayout={updateScrollState}
                    scrollRoot={scrollRef}
                  />
                ))
              : null}
          </div>
        )}
        {document ? (
          <span className="reference-pdf__scroll-track" aria-hidden="true" style={indicatorStyle}>
            <span />
          </span>
        ) : null}
      </div>
    </div>
  );
}

function PdfPage({
  document,
  number,
  onLayout,
  scrollRoot,
}: {
  readonly document: PDFDocumentProxy;
  readonly number: number;
  readonly onLayout: () => void;
  readonly scrollRoot: RefObject<HTMLDivElement | null>;
}) {
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");
  const [aspectRatio, setAspectRatio] = useState("210 / 297");
  const [renderError, setRenderError] = useState(false);
  const pageRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const pageElement = pageRef.current;
    const root = scrollRoot.current;
    if (!pageElement || !root) return;

    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry?.isIntersecting ?? false),
      { root, rootMargin: "100% 0px" },
    );
    observer.observe(pageElement);
    return () => observer.disconnect();
  }, [scrollRoot]);

  useEffect(() => {
    const pageElement = pageRef.current;
    const canvas = canvasRef.current;
    if (!visible || !pageElement || !canvas) return;

    let disposed = false;
    let renderTask: RenderTask | undefined;
    const resizeObserver = new ResizeObserver(() => void renderPage());

    async function renderPage() {
      try {
        renderTask?.cancel();
        const page = await document.getPage(number);
        if (disposed || !pageElement || !canvas) return;

        const baseViewport = page.getViewport({ scale: 1 });
        setAspectRatio(`${baseViewport.width} / ${baseViewport.height}`);
        const width = Math.max(1, pageElement.clientWidth);
        const viewport = page.getViewport({ scale: width / baseViewport.width });
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);

        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        renderTask = page.render({
          canvas,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
          viewport,
        });
        await renderTask.promise;
        if (!disposed) {
          setRenderError(false);
          onLayout();
        }
      } catch (caughtError) {
        if (
          !disposed &&
          !(caughtError instanceof Error && caughtError.name === "RenderingCancelledException")
        ) {
          setRenderError(true);
        }
      }
    }

    resizeObserver.observe(pageElement);
    void renderPage();

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      renderTask?.cancel();
      canvas.width = 0;
      canvas.height = 0;
      canvas.style.width = "100%";
      canvas.style.height = "100%";
    };
  }, [document, number, onLayout, visible]);

  return (
    <article
      className="reference-pdf__page"
      data-pdf-page={number}
      ref={pageRef}
      style={{ aspectRatio }}
    >
      <canvas aria-label={`Страница ${number}`} ref={canvasRef} />
      <span className="reference-pdf__page-number" aria-hidden="true">
        {number}
      </span>
      {renderError ? <p role="alert">Не удалось отобразить страницу {number}.</p> : null}
    </article>
  );
}
