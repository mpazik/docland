import { DocumentAnnotationsIndex } from "../../functions/indexes/document-annotations-index";
import { LinkedDataStoreWrite } from "../../functions/store";
import { LinkedDataStoreRead } from "../../functions/store/local-store";
import {
  fork,
  nextTick,
  passOnlyChanged,
  withMultiState,
  withState,
} from "../../libs/connections";
import { filter, nonNull } from "../../libs/connections/filters";
import { ignoreParam, map, pick, to } from "../../libs/connections/mappers";
import { throwIfNull } from "../../libs/errors";
import { HashUri } from "../../libs/hash";
import { Component, div, newSlot } from "../../libs/simple-ui/render";

import {
  Annotation,
  AnnotationSelector,
  createAnnotation,
  DocFragment,
  isQuoteSelector,
  QuoteSelector,
} from "./annotation";
import { annotationDisplay, commentForm } from "./annotation-display";
import { containerText, removeSelector, renderSelector } from "./highlights";
import { quoteSelectorForRange } from "./quote-selector";
import { currentSelection, Selection, selectionPosition } from "./selection";
import { selectionToolbar } from "./selection-toolbar";

type AnnotationSaveArgs = {
  selector: AnnotationSelector;
  content?: string;
};

export type AnnotationDisplayRequest = {
  textLayer: HTMLElement;
  fragment?: DocFragment;
};

export const getQuoteSelector = (
  selector: AnnotationSelector
): QuoteSelector => {
  if (isQuoteSelector(selector)) {
    return selector;
  }
  const child = throwIfNull(selector.refinedBy);
  if (isQuoteSelector(child)) {
    return child;
  }
  throw new Error(
    `Expected quote selector but got: ${JSON.stringify(selector)}`
  );
};

export const annotationsSupport: Component<
  {
    ldStoreWrite: LinkedDataStoreWrite;
    ldStoreRead: LinkedDataStoreRead;
    documentAnnotationsIndex: DocumentAnnotationsIndex;
    requestDocumentSave: () => void;
  },
  {
    displayDocumentAnnotations: AnnotationDisplayRequest;
    setCreator: string;
    setContainer: HTMLElement;
    setReference: HashUri | undefined;
  }
> = ({
  ldStoreWrite,
  ldStoreRead,
  requestDocumentSave,
  documentAnnotationsIndex,
}) => (render, onClose) => {
  const [saveAnnotation, [setCreator, setReference]] = withMultiState<
    [string, HashUri | undefined],
    AnnotationSaveArgs
  >(
    ([creator, reference], annotationSaveArgs) => {
      if (!reference) {
        keepAnnotationForSave(annotationSaveArgs);
        requestDocumentSave();
        return;
      }
      const { selector, content } = annotationSaveArgs;
      const annotation = createAnnotation(
        reference,
        selector,
        content,
        creator ?? undefined
      );
      ldStoreWrite(annotation).then(() => {
        changeSelection(["display", annotation]);
      });
    },
    undefined,
    undefined
  );

  const [
    saveKeptAnnotation,
    keepAnnotationForSave,
  ] = withState<AnnotationSaveArgs | null>(
    filter(nonNull, (annotationToSave) => {
      saveAnnotation(annotationToSave);
      keepAnnotationForSave(null);
    }),
    null
  );

  const [
    changeSelection,
    [setContainerForSelector, setTextLayerForSelector],
  ] = withMultiState<
    [HTMLElement, HTMLElement | undefined],
    ["display", Annotation] | ["select", Selection] | ["remove", QuoteSelector]
  >(
    ([container, textLayer], change) => {
      if (!container || !textLayer) {
        return;
      }
      const text = containerText(textLayer);
      if (change[0] === "display") {
        const annotation = change[1];
        renderSelector(
          container,
          textLayer,
          text,
          getQuoteSelector(annotation.target.selector),
          annotation.motivation === "commenting" ? "yellow" : "green",
          map(
            (position) => ({
              annotation,
              position,
            }),
            displayAnnotation
          ),
          hideAnnotationDelayed
        );
      } else if (change[0] === "select") {
        const selection = change[1];
        const position = selectionPosition(selection);
        const { fragment, range } = selection;
        const selector = quoteSelectorForRange(
          textLayer,
          text,
          range,
          fragment
        );
        renderSelector(
          container,
          textLayer,
          text,
          getQuoteSelector(selector),
          "purple"
        );
        displayCommentForm([
          "visible",
          {
            selector,
            position,
          },
        ]);
      } else {
        const selector = change[1];
        removeSelector(textLayer, text, selector);
      }
    },
    undefined,
    undefined
  );

  const [selectionToolbarSlot, { selectionHandler }] = newSlot(
    "selection-toolbar",
    selectionToolbar({
      buttons: [
        {
          handler: (it) => changeSelection(["select", it]),
          label: "comment",
          shortCutKey: "KeyC",
        },
        {
          handler: ({ container, range, fragment }) => {
            const text = containerText(container);
            const selector = quoteSelectorForRange(
              container,
              text,
              range,
              fragment
            );
            saveAnnotation({ selector });
          },
          label: "highlight",
          shortCutKey: "KeyH",
        },
      ],
    })
  );

  const [
    handleSelection,
    [setFragmentForToolbar, setContainerForToolbar],
  ] = withMultiState<[DocFragment | undefined, HTMLElement], void>(
    map(([fragment, container]) => {
      if (!container) return;
      const range = currentSelection();
      if (!range) return;
      if (!container.contains(range.commonAncestorContainer)) return;
      return { range, fragment, container };
    }, passOnlyChanged(selectionHandler)),
    undefined,
    undefined
  );

  const [
    annotationDisplaySlot,
    { displayAnnotation, hideAnnotationDelayed, hideAnnotation },
  ] = newSlot("annotation-display", annotationDisplay());

  const [commentFormSlot, { displayCommentForm }] = newSlot(
    "comment-form",
    commentForm({
      onHide: ({ selector }) =>
        changeSelection(["remove", getQuoteSelector(selector)]),
      onCreatedComment: ({ selector, comment }) => {
        saveAnnotation({ selector, content: comment });
      },
    })
  );

  const [
    displayDocumentAnnotations,
    setReferenceForAnnotationDisplay,
  ] = withState<HashUri | undefined, AnnotationDisplayRequest>(
    async (reference, { fragment }) => {
      const annotationsHashUris = await documentAnnotationsIndex({
        documentHashUri: throwIfNull(reference),
        fragment: fragment?.value,
      });
      annotationsHashUris.forEach((hashUri) => {
        ldStoreRead(hashUri).then(
          filter(nonNull, (annotation) => {
            changeSelection(["display", (annotation as unknown) as Annotation]);
          })
        );
      });
    },
    undefined
  );

  // next tick to make sure current selection would be calculated for even handling
  const detectSelection = map(to(undefined), nextTick(handleSelection));
  document.addEventListener("mouseup", detectSelection);
  onClose(() => {
    document.removeEventListener("mouseup", detectSelection);
  });

  render(div(commentFormSlot, annotationDisplaySlot, selectionToolbarSlot));
  return {
    setReference: fork(
      setReference,
      setReferenceForAnnotationDisplay,
      ignoreParam(saveKeptAnnotation)
    ),
    setContainer: fork(
      setContainerForSelector,
      setContainerForToolbar,
      map(to(undefined), setTextLayerForSelector)
    ),
    setCreator: setCreator,
    displayDocumentAnnotations: fork(
      map(pick("fragment"), setFragmentForToolbar),
      map(pick("textLayer"), setTextLayerForSelector),
      displayDocumentAnnotations,
      map(to(undefined), handleSelection),
      () => displayCommentForm(["hidden"]),
      () => hideAnnotation()
    ),
  };
};
