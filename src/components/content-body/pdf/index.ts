import type { Callback, Callbacks } from "linki";
import {
  defined,
  definedTuple,
  filter,
  fork,
  link,
  map,
  passUndefined,
  pick,
  valueWithState,
  withDefaultValue,
  withOptionalState,
} from "linki";
import * as pdfJsLib from "pdfjs-dist";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { TextLayerBuilder } from "pdfjs-dist/lib/web/text_layer_builder.js";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
// eslint-disable-next-line import/order
import { EventBus } from "pdfjs-dist/lib/web/ui_utils.js";
import "./text_layer_builder.css";

import type { PDFDocumentProxy } from "pdfjs-dist/types/display/api";

import { combine, match } from "../../../libs/linki";
import type { Handlers, ViewSetup } from "../../../libs/simple-ui/render";
import { a, button, div, newSlot, span } from "../../../libs/simple-ui/render";
import { getKey, getTarget } from "../../../libs/simple-ui/utils/funtions";
import { createPdfFragment } from "../../annotations/annotation";
import { loaderWithContext } from "../../common/loader";
import type { ContentComponent, DisplayContext } from "../types";
import { isFocusedElementStatic, scrollToTop } from "../utils";

// The workerSrc property shall be specified.
pdfJsLib.GlobalWorkerOptions.workerSrc = location.origin + "/pdf.worker.js";

type PdfDocument = PDFDocumentProxy;
type PdfPage = {
  canvas: HTMLElement;
  textLayer: HTMLElement;
  currentPage: number;
  numberOfPages: number;
  zoom: number;
};

type OpenPageRequest = [page: number, zoomLevel: number];

const zoomLevels = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0];
const defaultZoom = 3;

const openPage = async (
  pdfDocument: PdfDocument,
  [pageNumber, zoom]: OpenPageRequest,
  abortSignal: AbortSignal
): Promise<PdfPage | undefined> => {
  let canceled = false;
  abortSignal.addEventListener("abort", () => (canceled = true));

  const canvas = document.createElement("canvas");
  const textLayer = document.createElement("div");
  textLayer.classList.add("textLayer");

  const page = await pdfDocument.getPage(pageNumber);
  if (canceled) return;
  const textContent = await page.getTextContent();
  if (canceled) return;

  const viewport = page.getViewport({ scale: zoomLevels[zoom] });
  const devicePixelRatio = window.devicePixelRatio;
  canvas.height = viewport.height * devicePixelRatio;
  canvas.width = viewport.width * devicePixelRatio;
  canvas.style.height = viewport.height + "px";
  canvas.style.width = viewport.width + "px";
  textLayer.style.width = viewport.width + "px";
  textLayer.style.height = viewport.height + "px";
  textLayer.style.left = "50%";
  textLayer.style.transform = "translateX(-50%)";

  const canvasContext = canvas.getContext("2d")!;
  canvasContext.scale(devicePixelRatio, devicePixelRatio);
  await page.render({
    canvasContext,
    viewport: viewport,
  });
  if (canceled) return;

  const textLayerObj = new TextLayerBuilder({
    textLayerDiv: textLayer,
    pageIndex: page._pageIndex,
    viewport: viewport,
    eventBus: new EventBus(),
  });
  textLayerObj.setTextContent(textContent);
  textLayerObj.render();

  return {
    canvas,
    textLayer,
    currentPage: pageNumber,
    numberOfPages: pdfDocument.numPages,
    zoom,
  };
};

const setupPdfNav: ViewSetup<
  { zoomIn: () => void; zoomOut: () => void },
  {
    currentPage: number;
    numberOfPages: number;
    zoom: number;
  }
> = ({ zoomIn, zoomOut }) => ({ currentPage, numberOfPages, zoom }) =>
  div(
    {
      class:
        "d-flex flex-justify-between flex-items-center with-line-length-settings",
    },
    a(
      {
        href: `#page=${currentPage - 1}`,
        style: { visibility: currentPage === 1 ? "hidden" : "visible" },
      },
      "← previous"
    ),
    button(
      {
        onClick: zoomOut,
        class: "btn-link",
        type: "button",
        style: { visibility: zoom === 0 ? "hidden" : "visible" },
      },
      "zoom out"
    ),
    span(`${currentPage}/${numberOfPages}`),
    button(
      {
        onClick: zoomIn,
        class: "btn-link",
        type: "button",
        style: {
          visibility: zoom === zoomLevels.length - 1 ? "hidden" : "visible",
        },
      },
      "zoom in"
    ),
    a(
      {
        href: `#page=${currentPage + 1}`,
        style: {
          visibility: currentPage === numberOfPages ? "hidden" : "visible",
        },
      },
      "next →"
    )
  );

const getFragmentForPage = (currentPage: number): string =>
  "page=" + currentPage;

const setupPdfPageView: ViewSetup<
  {
    onDisplay: Callback<DisplayContext>;
    zoomIn: () => void;
    zoomOut: () => void;
  },
  PdfPage
> = ({ onDisplay, zoomOut, zoomIn }) => {
  const pdfNav = setupPdfNav({ zoomOut, zoomIn });
  return ({ currentPage, canvas, textLayer, numberOfPages, zoom }) =>
    div(
      pdfNav({
        currentPage,
        numberOfPages,
        zoom,
      }),
      div(
        {
          class: "position-relative d-flex flex-justify-center",
          onDisplay: link(map(getTarget), (container) =>
            onDisplay({
              container,
              fragmentForAnnotations: createPdfFragment(
                getFragmentForPage(currentPage)
              ),
              fragment: getFragmentForPage(currentPage),
            })
          ),
        },
        div({
          dangerouslySetDom: canvas,
        }),
        div({
          dangerouslySetDom: textLayer,
        })
      ),
      pdfNav({
        currentPage,
        numberOfPages,
        zoom,
      })
    );
};

const openPdf = (content: Blob): Promise<PdfDocument> =>
  content.arrayBuffer().then(
    (data) =>
      pdfJsLib.getDocument({
        data: new Uint8Array(data),
      }).promise
  );

const parsePageFragment = (fragment: string): number | undefined => {
  const parsePageFragmentRaw = (fragment: string): number | undefined => {
    if (!fragment.startsWith("page=")) return;
    try {
      return Number.parseInt(fragment.substring(5));
    } catch (e) {
      return undefined;
    }
  };

  const page = parsePageFragmentRaw(fragment);
  if (page) {
    return page;
  }
  console.error(`Could not parse page number from ${fragment}`);
};

type ChangePageDirection = "left" | "right";
type ZoomDirection = "in" | "out";

export const pdfDisplay: ContentComponent = ({
  onDisplay,
  onCurrentFragmentResponse,
}) => (render, onClose) => {
  const [contentSlot, { renderPage }] = newSlot(
    "content",
    (
      render
    ): Handlers<{
      renderPage: PdfPage;
    }> => ({
      renderPage: link(
        map(
          setupPdfPageView({
            onDisplay: fork(
              onDisplay,
              link(map(pick("container")), scrollToTop)
            ),
            zoomIn: () => switchZoom("in"),
            zoomOut: () => switchZoom("out"),
          })
        ),
        render
      ),
    })
  );

  const [switchPage, setPageState]: Callbacks<
    [ChangePageDirection, PdfPage | undefined]
  > = link(
    valueWithState<PdfPage | undefined, ChangePageDirection>(undefined),
    filter(definedTuple),
    map(([page, direction]): number | undefined => {
      if (direction === "left" && page.currentPage > 1) {
        return page.currentPage - 1;
      } else if (
        direction === "right" &&
        page.currentPage < page.numberOfPages
      ) {
        return page.currentPage + 1;
      }
    }),
    filter(defined),
    (it) => {
      openPageNumber(it);
    }
  );

  const [switchZoom, setZoomState] = link(
    valueWithState<number, ZoomDirection>(defaultZoom),
    map(([zoom, direction]): number | undefined => {
      if (direction === "out" && zoom > 0) {
        return zoom - 1;
      } else if (direction === "in" && zoom < zoomLevels.length - 1) {
        return zoom + 1;
      }
    }),
    filter(defined),
    (it) => {
      changeZoom(it);
    }
  );

  const [returnCurrentFragment, setPageNumberForFragment] = link(
    withOptionalState<number>(undefined),
    filter(defined),
    map(getFragmentForPage),
    onCurrentFragmentResponse
  );

  const { load, init } = loaderWithContext<
    PdfDocument,
    OpenPageRequest,
    PdfPage | undefined
  >({
    fetcher: (pdfDocument, request, signal) =>
      openPage(pdfDocument, request, signal),
    onLoaded: link(
      filter(defined),
      fork(
        renderPage,
        setPageState,
        link(map(pick("zoom")), setZoomState),
        link(map(pick("currentPage")), setPageNumberForFragment)
      )
    ),
    contentSlot,
  })(render, onClose);

  const [openPageNumber, changeZoom] = link(
    combine<OpenPageRequest>(1, defaultZoom),
    (it) => load(it)
  );

  const switchPageKeyListener: Callback<KeyboardEvent> = link(
    filter(isFocusedElementStatic),
    map(
      getKey,
      match<string, ChangePageDirection>([
        ["ArrowLeft", "left"],
        ["ArrowUp", "left"],
        ["ArrowRight", "right"],
        ["ArrowDown", "right"],
      ])
    ),
    filter(defined),
    switchPage
  );

  document.addEventListener("keyup", switchPageKeyListener);
  onClose(() => document.removeEventListener("keyup", switchPageKeyListener));

  return {
    displayContent: fork(
      link(map(pick("content"), openPdf), init),
      link(
        map(
          pick("fragment"),
          passUndefined(parsePageFragment),
          withDefaultValue(1)
        ),
        openPageNumber
      )
    ),
    goToFragment: link(map(parsePageFragment), filter(defined), openPageNumber),
    requestCurrentFragment: returnCurrentFragment,
  };
};
