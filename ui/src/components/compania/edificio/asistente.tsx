// PLA-I39-7: Asistente floats. A button at the bottom right (above the tab bar and the safe area on a phone) with the
// unread count and a dot when Asistente waits on the owner. It opens the side page (?asistente) with the existing
// thread panel and composer (useThread); the 360 px column is gone.

export const AsistenteFab = ({ unread, waiting, onOpen }: { unread: number; waiting: boolean; onOpen: (el: HTMLElement) => void }) => (
  <button
    type="button"
    className="edi-fab"
    onClick={(e) => onOpen(e.currentTarget)}
    aria-haspopup="dialog"
    aria-label={`Asistente${unread > 0 ? `, ${unread === 1 ? "1 mensaje sin leer" : `${unread} mensajes sin leer`}` : ""}${waiting ? ", te espera" : ""}`}
    data-control="asistente"
    data-unread={unread}
    data-waiting={waiting ? "1" : undefined}
  >
    <span className="edi-face edi-fab-face" aria-hidden>
      A
    </span>
    Asistente
    {unread > 0 && (
      <span className="edi-badge" aria-hidden>
        {unread}
      </span>
    )}
    {waiting && <span className="edi-fab-dot" aria-hidden />}
  </button>
);
