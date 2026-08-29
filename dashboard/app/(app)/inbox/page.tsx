import Link from "next/link";
import { getConversations, getConversation, connected } from "../../../lib/api";
import { replyToConversation, updateConversation } from "../../../lib/actions";
import { fmt, label, CHANNEL_LABEL } from "../../../lib/format";
import { PageHead, Badge, Offline, Empty, Avatar } from "../../../lib/ui";

export const dynamic = "force-dynamic";

const FILTERS = ["all", "human_needed", "ai_handling", "open", "closed"];

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ c?: string; status?: string }> }) {
  if (!connected) return (<><PageHead title="Inbox" /><Offline what="Customer conversations" /></>);
  const sp = await searchParams;
  const filter = sp.status && sp.status !== "all" ? sp.status : undefined;
  const { conversations } = await getConversations(filter);
  const activeId = sp.c || conversations[0]?.id;
  const detail = activeId ? await getConversation(activeId) : null;

  return (
    <>
      <PageHead title="Inbox" lede="Inbound WhatsApp / SMS / email / Instagram threads. The AI replies and books; hand off to a human anytime." />

      <div className="seg" style={{ marginBottom: 12 }}>
        {FILTERS.map((f) => (
          <Link key={f} href={f === "all" ? "/inbox" : `/inbox?status=${f}`} className={(sp.status || "all") === f ? "active" : ""}>{label(f)}</Link>
        ))}
      </div>

      <div className="inbox">
        <div className="thread-list">
          {conversations.length ? conversations.map((cv) => (
            <Link key={cv.id} href={`/inbox?c=${cv.id}${filter ? `&status=${filter}` : ""}`} className={`thread-item ${cv.id === activeId ? "active" : ""}`}>
              <Avatar first={cv.first_name} last={cv.last_name} />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span className="spread">
                  <span className="who trunc">{fmt.name(cv.first_name, cv.last_name)}</span>
                  <span className="muted" style={{ fontSize: 11 }}>{fmt.rel(cv.last_message_at)}</span>
                </span>
                <span className="prev trunc" style={{ display: "block" }}>{cv.last_body || "—"}</span>
                <span className="row" style={{ gap: 5, marginTop: 4 }}>
                  <Badge>{CHANNEL_LABEL[cv.channel] || cv.channel}</Badge>
                  <Badge value={cv.status} />
                  {cv.unread_count ? <span className="badge bad">{cv.unread_count}</span> : null}
                </span>
              </span>
            </Link>
          )) : <Empty>No conversations.</Empty>}
        </div>

        <div className="card">
          {detail && !detail.error ? (
            <>
              <div className="spread" style={{ marginBottom: 10 }}>
                <div>
                  <h2 style={{ fontSize: 15 }}>
                    <Link href={`/customers/${detail.conversation.contact_id}`}>{fmt.name(detail.conversation.first_name, detail.conversation.last_name)}</Link>
                  </h2>
                  <div className="cell-sub">{CHANNEL_LABEL[detail.conversation.channel] || detail.conversation.channel} · {label(detail.conversation.lifecycle_stage)} · {detail.conversation.total_bookings} visits</div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <form action={updateConversation}>
                    <input type="hidden" name="conversationId" value={detail.conversation.id} />
                    <input type="hidden" name="aiEnabled" value={detail.conversation.ai_enabled ? "false" : "true"} />
                    <button className="btn sm" type="submit">{detail.conversation.ai_enabled ? "Pause AI" : "Resume AI"}</button>
                  </form>
                  {detail.conversation.status !== "closed" ? (
                    <form action={updateConversation}>
                      <input type="hidden" name="conversationId" value={detail.conversation.id} />
                      <input type="hidden" name="status" value="closed" />
                      <button className="btn sm ghost" type="submit">Close</button>
                    </form>
                  ) : null}
                </div>
              </div>

              <div className="bubbles" style={{ maxHeight: "52vh", overflowY: "auto" }}>
                {detail.messages.map((mm) => (
                  <div key={mm.id} className={`bubble ${mm.direction === "inbound" ? "in" : "out"}`}>
                    {mm.body}
                    <div className="meta">
                      {mm.direction === "inbound" ? "Customer" : mm.ai_generated ? "AI" : "Staff"} · {fmt.dateTime(mm.sent_at || mm.created_at)}
                      {mm.direction === "outbound" && mm.delivery_status !== "sent" ? ` · ${label(mm.delivery_status)}` : ""}
                    </div>
                  </div>
                ))}
                {!detail.messages.length ? <Empty>No messages.</Empty> : null}
              </div>

              <form action={replyToConversation} className="row" style={{ gap: 8, marginTop: 12 }}>
                <input type="hidden" name="conversationId" value={detail.conversation.id} />
                <input className="input" name="body" placeholder="Type a reply as the salon…" required style={{ flex: 1 }} />
                <button className="btn primary" type="submit">Send</button>
              </form>
            </>
          ) : <Empty>Select a conversation.</Empty>}
        </div>
      </div>
    </>
  );
}
