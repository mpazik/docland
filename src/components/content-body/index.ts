import { Callback, fork, ignoreParam, link, withOptionalState } from "linki";

import { LinkedDataWithContent } from "../../functions/content-processors";
import { ContentSaver } from "../../functions/content-saver";
import {
  select,
  split,
  withMultiState,
  withState,
} from "../../libs/connections";
import { map, passUndefined, pick, pipe } from "../../libs/connections/mappers";
import { throwIfUndefined } from "../../libs/errors";
import { LinkedData } from "../../libs/jsonld-format";
import {
  epubMediaType,
  getEncoding,
  htmlMediaType,
  pdfMediaType,
} from "../../libs/ld-schemas";
import {
  Component,
  div,
  newCloseController,
} from "../../libs/simple-ui/render";
import { AnnotationDisplayRequest } from "../annotations";

import { epubDisplay } from "./epub";
import { htmlDisplay } from "./html";
import { htmlEditableDisplay } from "./html-editable";
import { pdfDisplay } from "./pdf";
import { ContentComponent, DisplayContext, DisplayController } from "./types";

const isEditable: (linkedData: LinkedData) => boolean = () => false;

export type LinkedDataWithContentAndFragment = LinkedDataWithContent & {
  fragment?: string;
};

export const contentDisplayComponent: Component<
  {
    contentSaver: ContentSaver;
    onAnnotationDisplayRequest: Callback<AnnotationDisplayRequest>;
    onCurrentFragmentResponse: Callback<string | undefined>;
    onDisplay: Callback;
  },
  {
    displayContent: LinkedDataWithContentAndFragment;
    goToFragment: string;
    requestCurrentFragment: void;
  }
> = ({
  onCurrentFragmentResponse,
  onAnnotationDisplayRequest,
  contentSaver,
  onDisplay,
}) => (render, onClose) => {
  // multi state with linkedData and fallback for update
  const [
    saveNewContent,
    [setLinkedDataForSave, setCallbackForUpdate],
  ] = withMultiState<[LinkedData, Callback | undefined], Blob>(
    ([linkedData, callback], blob) => {
      contentSaver({
        linkedData: throwIfUndefined(linkedData),
        content: blob,
      }).then(() => throwIfUndefined(callback)());
    },
    undefined,
    undefined
  );

  const [goToFragment, setCallbackForFragment] = withState<
    Callback<string>,
    string
  >((goToFragment, fragment) => {
    goToFragment(fragment);
  }, undefined);

  const [
    requestCurrentFragment,
    setCallbackForReqFragment,
    resetCallbackForReqFragment,
  ] = link(withOptionalState<Callback>(), (requestFragment) =>
    requestFragment?.()
  );

  // content to send last fragment before close
  // put start view date to context
  // figure out epub

  const [
    closeContentComponent,
    [setCallbackForCloseComponent],
  ] = withMultiState<[Callback]>(([closeComponent]) => {
    if (closeComponent) {
      closeComponent();
    }
  }, undefined);

  onClose(closeContentComponent);

  const displayAnnotations: Callback<DisplayContext> = fork(
    ({ fragmentForAnnotations: fragment, container }) =>
      onAnnotationDisplayRequest({ fragment, textLayer: container })
  );

  const displayController: DisplayController = {
    onDisplay: fork(displayAnnotations, link(ignoreParam(), onDisplay)),
    onContentModified: saveNewContent,
    onCurrentFragmentResponse,
  };

  const displayContentComponent = (component: ContentComponent) => ({
    content,
    fragment,
  }: LinkedDataWithContentAndFragment) => {
    closeContentComponent();
    const [onClose, close] = newCloseController();
    const {
      displayContent,
      saveComplete,
      goToFragment,
      requestCurrentFragment,
    } = component(displayController)(render, onClose);
    setCallbackForCloseComponent(close);
    setCallbackForUpdate(saveComplete);
    setCallbackForFragment(goToFragment);
    requestCurrentFragment
      ? setCallbackForReqFragment(requestCurrentFragment)
      : resetCallbackForReqFragment();
    displayContent({ content, fragment });
  };

  const displayNotSupported = ({ linkedData }: LinkedDataWithContent) => {
    render(
      div(`Content type ${linkedData["encodingFormat"]} is not supported`)
    );
  };

  return {
    displayContent: fork(
      map(pick("linkedData"), setLinkedDataForSave),
      select<LinkedDataWithContent, string | undefined>(
        pipe(pick("linkedData"), passUndefined(getEncoding)),
        [
          [
            htmlMediaType,
            split(
              pipe(pick("linkedData"), isEditable),
              displayContentComponent(htmlEditableDisplay),
              displayContentComponent(htmlDisplay)
            ),
          ],
          [pdfMediaType, displayContentComponent(pdfDisplay)],
          [epubMediaType, displayContentComponent(epubDisplay)],
        ],
        displayNotSupported
      )
    ),
    goToFragment,
    requestCurrentFragment,
  };
};
