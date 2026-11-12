// PLA-I39-3: a teammate's silhouette in its window, with the prop of its role (PO headset, Research glasses,
// Artist beret, Taller hard hat, QA magnifier; any other role plain). The arm shows only when it asks the owner,
// the laptop only while it works: the window's data-state decides, in CSS.
import { propOf } from "@/lib/edificio";

export const Figure = ({ role }: { role: string }) => {
  const prop = propOf(role);
  return (
    <svg className="edi-fig" viewBox="0 0 120 100" aria-hidden focusable="false" data-prop={prop}>
      <path className="f" d="M18 100C18 76 36 65 60 65s42 11 42 35z" />
      <rect className="f" x="53" y="54" width="14" height="14" rx="5" />
      <circle className="f" cx="60" cy="42" r="17" />
      {prop === "hardhat" && (
        <>
          <path className="f" d="M40 39a20 20 0 0 1 40 0h5a2 2 0 0 1 2 2v2H33v-2a2 2 0 0 1 2-2z" />
          <rect className="f" x="56" y="16" width="8" height="8" rx="2" />
        </>
      )}
      {prop === "beret" && (
        <>
          <ellipse className="f" cx="55" cy="27" rx="24" ry="10" transform="rotate(-12 55 27)" />
          <circle className="f" cx="60" cy="14" r="3" />
        </>
      )}
      {prop === "glasses" && (
        <g className="c">
          <circle cx="52" cy="43" r="6" />
          <circle cx="68" cy="43" r="6" />
          <path d="M58 43h4" />
        </g>
      )}
      {prop === "headset" && (
        <>
          <path className="s" d="M39 43a21 21 0 0 1 42 0" strokeWidth="5" />
          <rect className="f" x="34" y="38" width="9" height="14" rx="3.5" />
          <path className="s" d="M38 52q1 11 15 10" strokeWidth="3.5" />
          <circle className="f" cx="54" cy="62" r="3.2" />
        </>
      )}
      {prop === "magnifier" && (
        <>
          <circle className="s" cx="24" cy="52" r="10" strokeWidth="5" />
          <path className="s" d="M31 60l9 13" strokeWidth="7" />
        </>
      )}
      <g className="edi-arm">
        <path className="s" d="M86 82Q98 72 101 48" strokeWidth="11.5" />
        <circle className="f" cx="102" cy="41" r="8.5" />
      </g>
      <g className="edi-lap">
        <rect className="l" x="37" y="79" width="46" height="26" rx="4" />
        <circle className="d" cx="60" cy="91" r="3" />
      </g>
    </svg>
  );
};
