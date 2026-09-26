import { Fragment, type ReactNode } from "react";

/**
 * Fills `{name}` placeholders in an already translated sentence with nodes,
 * usually links. The words around a link stay one translatable string, so
 * Croatian can put the link wherever its grammar needs it instead of the code
 * gluing sentence fragments together. A placeholder without a node is left
 * as written, the same way `format()` treats a missing variable.
 */
export function richText(template: string, nodes: Record<string, ReactNode>): ReactNode {
  return template
    .split(/(\{\w+\})/g)
    .filter((part) => part.length > 0)
    .map((part, index) => {
      const name = /^\{(\w+)\}$/.exec(part)?.[1];
      return (
        <Fragment key={index}>{name !== undefined && name in nodes ? nodes[name] : part}</Fragment>
      );
    });
}
