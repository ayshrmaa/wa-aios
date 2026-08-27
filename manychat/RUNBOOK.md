# ManyChat — Instagram & WhatsApp DM automation

ManyChat handles the conversation inside Instagram / WhatsApp. This system handles what happens
next: the lead is recorded with source attribution, followed up within minutes, and followed up
again until they book — and the DM follow-ups themselves are sent back through ManyChat.

Two integration points, both in this repo:

| Direction | What | Where |
|---|---|---|
| ManyChat → AIOS | a qualified DM becomes a lead | `POST /webhook/manychat-lead` |
| AIOS → ManyChat | follow-up DMs to that subscriber | `ManyChatTransport` (`MANYCHAT_API_KEY`) |

## Prerequisites (Meta, not code — start on onboarding day one)

1. Instagram **Business** account, linked to a Facebook Page the client administers.
2. Meta Business verification for the client's legal entity. Days to weeks.
3. ManyChat Pro account connected to that Instagram account (and WhatsApp, once the WABA is approved).

Nothing below works until step 2 clears. Everything below can be built and tested in ManyChat's
preview mode before that.

## 1. Inbound: DM → lead

Build one flow in ManyChat, triggered by: direct message, Story reply, comment keyword
(`price`, `info`, `book`), and the "DM us to book" CTA.

Flow shape:
1. Welcome message with the service menu as quick replies.
2. Ask three things, saving each to a **Custom User Field**: `service`, `urgency`
   (Sofort / Diese Woche / Flexibel), `preferred_time`.
3. Ask for a phone number only if they want WhatsApp reminders; save to the built-in phone field.
4. **External Request** action → this is the hand-off:

```
Method   POST
URL      https://<API_BASE_URL>/webhook/manychat-lead
Headers  content-type: application/json
         x-retell-webhook-secret: <RETELL_WEBHOOK_SECRET>
Body     {
           "subscriber_id": "{{subscriber_id}}",
           "first_name":    "{{first_name}}",
           "last_name":     "{{last_name}}",
           "ig_username":   "{{ig_username}}",
           "phone":         "{{phone}}",
           "email":         "{{email}}",
           "channel":       "instagram",
           "custom_fields": {
             "service":        "{{cuf_service}}",
             "urgency":        "{{cuf_urgency}}",
             "preferred_time": "{{cuf_preferred_time}}"
           }
         }
```

Use `"channel": "whatsapp"` in the WhatsApp version of the flow.

The response includes `leadId`, `channel` and `followUpsScheduled`. Map `message` to a text
step if you want ManyChat to confirm ("Danke — wir melden uns in wenigen Minuten").

5. Final step: send the booking link (`links.booking` in tenant config) or hand off to a human
   with ManyChat's *Assign to team member*.

Field names: ManyChat exposes custom fields as `{{cuf_<name>}}` in the External Request body
editor. Verify the exact token in your account — ManyChat has renamed these before.

## 2. Outbound: follow-up DMs through ManyChat

Set on the API:

```
MANYCHAT_API_KEY=<ManyChat → Settings → API → Generate>
MESSAGE_TRANSPORT_INSTAGRAM=manychat
```

Every lead that arrived from Instagram gets its ladder (instant, day 1, day 3, day 7, day 14)
delivered as DMs to that subscriber. Consent is implicit: the subscriber id only exists because
they messaged the page. Meta's 24-hour rule applies — sends outside the window use the
`ACCOUNT_UPDATE` tag, which covers appointment and enquiry updates. Marketing content is not
allowed there; keep the templates as they are.

Test without Meta: `curl` the webhook above with a made-up `subscriber_id` and watch the
Nachrichten page in the dashboard queue five Instagram messages. They will show as *Simuliert*
until `MANYCHAT_API_KEY` is set, and as *Abgebrochen* if ManyChat rejects the subscriber id.

## 3. What the dashboard shows

Leads page: source *Instagram*, channel *Instagram*, follow-ups sent, next follow-up time.
Booking through the receptionist or the website with the same phone number closes the ladder
automatically.

## Not in scope here

Story posting, comment moderation, ad campaigns. ManyChat's own UI is the deliverable for the
conversation; this document is the contract between it and the rest of the system.
