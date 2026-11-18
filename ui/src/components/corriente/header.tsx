// PLA-I62-1: the global header under the app bar (header B of the kit): Compañía, the four global places, the live
// clock, what waits on Jorge in amber, and Pedir (always secondary: the white button is each page's own action).
import { Link } from "react-router";
import { clockLine, hrefOf, type View } from "@/lib/corriente";
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
};

const Tab = ({ to, on, children }: { to: string; on: boolean; children: React.ReactNode }) => (
  <Link className="cor-tab" to={to} aria-current={on ? "page" : undefined}>
    {children}
  </Link>
);

export const Head = ({ view, waiting, asistenteUnread = 0, now, timeZone, pedirTo, tocaTo, closeTo }: HeadProps) => (
  <header className="cor-head" data-cor-head>
    <nav className="cor-head-left" aria-label="Compañía">
      <span className="cor-head-name">Compañía</span>
      <Tab to={hrefOf({ view: "corriente" })} on={view === "corriente"}>
        Corriente
      </Tab>
      <Tab to={hrefOf({ view: "tetoca" })} on={view === "tetoca"}>
        Te toca
        {waiting > 0 && <span className="cor-count amber">{waiting}</span>}
      </Tab>
      <Tab to={hrefOf({ view: "asistente" })} on={view === "asistente"}>
        Asistente
        {asistenteUnread > 0 && (
          <span className="cor-unread" aria-label={`${asistenteUnread} sin leer`}>
            {asistenteUnread}
          </span>
        )}
      </Tab>
      <Tab to="/machine" on={view === "plomeria"}>
        Plomería
      </Tab>
      {/* PLA-I63-1: the Brief tab shows only when the address opens it; I63-5 makes it a tab of its own. */}
      {view === "brief" && (
        <Tab to={hrefOf({ view: "brief" })} on>
          Brief
        </Tab>
      )}
    </nav>
    <div className="cor-head-right">
      <span className="cor-clock" data-clock>
        <Live />
        <b>En vivo</b>
        <span>· {clockLine(now, timeZone)}</span>
      </span>
      {waiting > 0 && (
        <Link to={tocaTo} className="cor-btn amber" data-te-esperan={waiting}>
          <You flat />
          {waiting === 1 ? "1 te espera" : `${waiting} te esperan`}
        </Link>
      )}
      {closeTo ? (
        <Link to={closeTo} className="cor-btn secondary" data-control="cerrar-pedir">
          Cerrar
        </Link>
      ) : (
        <Link to={pedirTo} className="cor-btn secondary" data-pedir>
          Pedir
        </Link>
      )}
    </div>
  </header>
);
