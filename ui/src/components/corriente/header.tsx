// PLA-I62-1: the global header under the app bar (header B of the kit): Compañía, the four global places, the live
// clock, what waits on the owner in amber, and Pedir (always secondary: the white button is each page's own action).
import { Link } from "react-router";
import { clockLine, hrefOf, type View } from "@/lib/corriente";
import { HEADER_WORDS } from "@/lib/header-words";
import { words } from "@/lib/i18n";
import { Live, You } from "./parts";

export type HeadProps = {
  view: View | "plomeria" | null;
  /** Pending decisions across the company. */
  waiting: number;
  asistenteUnread?: number;
  now: number;
  timeZone?: string;
  /** Where Pedir goes (the Pedir page, or the building's ask box until it exists). */
  pedirTo: string;
  /** Where «N te esperan» goes. */
  tocaTo: string;
  /** On the Pedir page the button closes it instead (back to where he was). */
  closeTo?: string;
  /** What still waits on the owner in today's brief (open blockers and «te toca»). */
  briefToca?: number;
};

const Tab = ({ to, on, children }: { to: string; on: boolean; children: React.ReactNode }) => (
  <Link className="cor-tab" to={to} aria-current={on ? "page" : undefined}>
    {children}
  </Link>
);

export const Head = ({ view, waiting, asistenteUnread = 0, now, timeZone, pedirTo, tocaTo, closeTo, briefToca = 0 }: HeadProps) => {
  const w = words(HEADER_WORDS);
  return (
    <header className="cor-head" data-cor-head>
      <nav className="cor-head-left" aria-label={w.company}>
        <span className="cor-head-name">{w.company}</span>
        <Tab to={hrefOf({ view: "corriente" })} on={view === "corriente"}>
          {w.corriente}
        </Tab>
        <Tab to={hrefOf({ view: "tetoca" })} on={view === "tetoca"}>
          {w.tetoca}
          {waiting > 0 && <span className="cor-count amber">{waiting}</span>}
        </Tab>
        <Tab to={hrefOf({ view: "asistente" })} on={view === "asistente"}>
          {w.asistente}
          {asistenteUnread > 0 && (
            <span className="cor-unread" aria-label={w.unread(asistenteUnread)}>
              {asistenteUnread}
            </span>
          )}
        </Tab>
        <Tab to="/machine" on={view === "plomeria"}>
          {w.plomeria}
        </Tab>
        {/* PLA-I63-5: the Morning brief, after Plomería; its count is what still waits on the owner in today's brief. */}
        <Tab to={hrefOf({ view: "brief" })} on={view === "brief"}>
          {w.brief}
          {briefToca > 0 && <span className="cor-count amber">{briefToca}</span>}
        </Tab>
      </nav>
      <div className="cor-head-right">
        <span className="cor-clock" data-clock>
          <Live />
          <b>{w.live}</b>
          <span>· {clockLine(now, timeZone)}</span>
        </span>
        {waiting > 0 && (
          <Link to={tocaTo} className="cor-btn amber" data-te-esperan={waiting}>
            <You flat />
            {w.waiting(waiting)}
          </Link>
        )}
        {closeTo ? (
          <Link to={closeTo} className="cor-btn secondary" data-control="cerrar-pedir">
            {w.close}
          </Link>
        ) : (
          <Link to={pedirTo} className="cor-btn secondary" data-pedir>
            {w.pedir}
          </Link>
        )}
      </div>
    </header>
  );
};
