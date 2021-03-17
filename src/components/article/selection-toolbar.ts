import { fork, passOnlyChanged, Provider } from "../../libs/connections";
import { filter, map, mapTo, not } from "../../libs/connections/processors2";
import { b, button, Component, div, View } from "../../libs/simple-ui/render";
import { isKey } from "../../libs/simple-ui/utils/funtions";

import {
  OptSelection,
  Position,
  Selection,
  selectionExists,
  selectionPosition,
} from "./selection";

export type Button = {
  handler: (selection: Selection) => void;
  label: string;
  shortCutKey?: string;
};

const keyCodeToKeyName = (keyCode: string) => {
  if (keyCode.startsWith("Key")) {
    return keyCode.substring(3);
  }
  return keyCode;
};

export const selectionToolbarView: View<{
  position: Position;
  buttons: Button[];
}> = ({ position: [left, top], buttons }) =>
  div(
    {
      class: "Popover",
      style: { left, top, transform: "translate(-50%, -125%)" },
    },
    div(
      {
        class:
          "Popover-message Popover-message--bottom BtnGroup box-shadow-large width-auto d-flex",
      },
      ...buttons.map(({ handler, label, shortCutKey }) =>
        button(
          {
            class: `BtnGroup-item btn btn-sm`,
            type: "button",
            onClick: handler,
          },
          ...(shortCutKey ? ["[", b(keyCodeToKeyName(shortCutKey)), "] "] : []),
          label
        )
      )
    )
  );

export const selectionToolbar: Component<{
  selectionProvider: Provider<OptSelection>;
  buttons: Button[];
}> = ({ selectionProvider, buttons }) => (render, onClose) => {
  const renderState = map((selection: OptSelection) => {
    if (!selection) return;
    return selectionToolbarView({
      position: selectionPosition(selection),
      buttons: buttons.map(({ handler, ...rest }) => ({
        handler: () => {
          handler(selection);
          selectionHandler(undefined);
        },
        ...rest,
      })),
    });
  }, render);

  let lastButtonHandlers: ((e: KeyboardEvent) => void)[] = [];

  const registerButtonHandler = (selection: OptSelection) => {
    lastButtonHandlers.forEach((handler) =>
      document.removeEventListener("keydown", handler)
    );
    lastButtonHandlers = [];

    if (selection) {
      lastButtonHandlers = buttons
        .filter((it) => Boolean(it.shortCutKey))
        .map(({ shortCutKey, handler }) =>
          filter(
            isKey(shortCutKey!),
            fork(() => handler(selection), mapTo(undefined, selectionHandler))
          )
        );
      lastButtonHandlers.forEach((handler) =>
        document.addEventListener("keydown", handler)
      );
    }
  };

  const selectionHandler = passOnlyChanged(
    fork(renderState, registerButtonHandler)
  );
  const mouseUpHandler = filter(
    not(selectionExists),
    mapTo(undefined, selectionHandler)
  );
  document.addEventListener("mouseup", mouseUpHandler);
  onClose(() => {
    document.removeEventListener("mouseup", mouseUpHandler);
  });
  selectionProvider(onClose, selectionHandler);
};
