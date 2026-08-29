import Link from "next/link";
import { getAppointments } from "../../../lib/api";
import { setAppointmentOutcome } from "../../../lib/actions";
import { fmt, label, CHANNEL_LABEL } from "../../../lib/format";
import { PageHead, Badge, DataTable, Stat } from "../../../lib/ui";
import type { Appointment } from "../../../lib/api";

export const dynamic = "force-dynamic";

export default async function AppointmentsPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const sp = await searchParams;
  const scope = sp.scope === "past" ? "past" : "upcoming";
  const rows = await getAppointments(scope);

  const revenue = rows.reduce((n, a) => n + (["booked", "completed"].includes(a.status) ? a.value_chf : 0), 0);
  const noShows = rows.filter((a) => a.status === "no_show").length;

  return (
    <>
      <PageHead title="Appointments" lede="Bookings made by the receptionist, synced to the shared calendar.">
        <div className="seg">
          <Link href="/appointments" className={scope === "upcoming" ? "active" : ""}>Upcoming</Link>
          <Link href="/appointments?scope=past" className={scope === "past" ? "active" : ""}>Past</Link>
        </div>
      </PageHead>

      <div className="grid cols-3" style={{ marginBottom: 14 }}>
        <Stat k={scope === "past" ? "Past appointments" : "Upcoming"} v={fmt.int(rows.length)} />
        <Stat k={scope === "past" ? "Revenue" : "Booked revenue"} v={fmt.chf(revenue)} />
        <Stat k="No-shows in view" v={fmt.int(noShows)} />
      </div>

      <DataTable<Appointment>
        rowKey={(a) => a.id}
        empty={scope === "past" ? "No past appointments." : "Nothing booked yet."}
        columns={[
          { key: "when", label: "When", render: (a) => (<><div className="cell-strong">{fmt.dateTime(a.starts_at)}</div><div className="cell-sub">{fmt.time(a.ends_at)} end</div></>) },
          { key: "cust", label: "Customer", render: (a) => (
            <Link href={a.contact_id ? `/customers/${a.contact_id}` : "#"}>
              <div>{fmt.name(a.first_name, a.last_name)}</div>
              <div className="cell-sub">{a.phone_e164 || a.email || "—"}</div>
            </Link>
          ) },
          { key: "svc", label: "Service", render: (a) => <span>{a.service} <span className="muted">· {a.staff}</span></span> },
          { key: "val", label: "Value", num: true, render: (a) => <span className="mono">{fmt.chf(a.value_chf)}</span> },
          { key: "src", label: "Via", render: (a) => <Badge>{a.booked_via ? label(a.booked_via) : CHANNEL_LABEL[a.lead_source || ""] || a.lead_source || "—"}</Badge> },
          { key: "st", label: "Status", render: (a) => <Badge value={a.status} /> },
          { key: "act", label: "", render: (a) => (
            a.status === "booked" ? (
              <div className="row" style={{ gap: 4 }}>
                <form action={setAppointmentOutcome}><input type="hidden" name="appointmentId" value={a.id} /><input type="hidden" name="outcome" value="completed" /><button className="btn sm" type="submit">Done</button></form>
                <form action={setAppointmentOutcome}><input type="hidden" name="appointmentId" value={a.id} /><input type="hidden" name="outcome" value="no_show" /><button className="btn sm danger" type="submit">No-show</button></form>
              </div>
            ) : null
          ) }
        ]}
        rows={rows}
      />
    </>
  );
}
