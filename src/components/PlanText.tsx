import React from "react";
import { parsePlanText } from "../utils/planText";

interface Props {
  text: string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Renders a plan text field: paragraphs, and "- Label: text" lines as a bulleted list. Spacing is
 * inline and in em so it inherits whatever font size it lands in, including the slide exports,
 * which html2canvas captures at their own sizes.
 */
export function PlanText({ text, className, style }: Props) {
  const blocks = parsePlanText(text);
  return (
    <div className={className} style={style}>
      {blocks.map((block, i) => {
        const gap = i === 0 ? 0 : "0.6em";
        if (block.type === "paragraph") return <p key={i} style={{ margin: 0, marginTop: gap }}>{block.text}</p>;
        return (
          <ul key={i} style={{ margin: 0, marginTop: gap, paddingLeft: "1.25em", listStyleType: "disc" }}>
            {block.items.map((item, j) => (
              <li key={j} style={{ marginTop: j === 0 ? 0 : "0.4em" }}>
                {item.label && <span style={{ fontWeight: 600, color: "inherit" }}>{item.label}: </span>}
                {item.text}
              </li>
            ))}
          </ul>
        );
      })}
    </div>
  );
}
