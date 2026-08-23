# Service 5 — WhatsApp + Instagram Automation

## Read this first

ManyChat flows are built by clicking in its UI. There is no meaningful "deploy from code" path, so
this is a **runbook**, not a program. Anyone claiming to ship this as source is shipping a diagram.

The deliverable is: this document, a ManyChat flow export per client, and screenshots of the built
flow. Budget 2–3 hours of clicking per client.

## The long pole

Meta Business verification gates everything here and takes days to weeks. **Start it on onboarding
day one**, before any build work. Every other service can go live without it; this one cannot.

Prerequisites, all client-side:
- Instagram Business account (not Personal, not Creator)
- Facebook Page linked to that Instagram account
- Meta Business Manager, verified
- WhatsApp Business number — dedicated, and not already registered to WhatsApp anywhere

That last one traps people. If the owner's number is already on consumer WhatsApp it must be deleted
from that account first, and that removes their chat history. Warn them before they do it, in writing.

## Flow 1 — Instagram DM

**Triggers:** direct DM, Story reply, comment containing `price`, `prices`, `info`, `book`, or the
"DM us to book" CTA.

```
Trigger
  └─ Welcome: "Hi! Thanks for messaging {{salon_name}} 👋 What can I help with?"
      └─ Quick replies: [Book an appointment] [Prices] [Opening hours] [Something else]
          ├─ Book      → Qualify flow
          ├─ Prices    → Service menu card → "Want to book?" → Qualify flow
          ├─ Hours     → Hours card → "Want to book?" → Qualify flow
          └─ Something else → Free text → complaint check → human handoff
```

**Qualify flow** — one question per message, never batched:
1. Which service?
2. Been in before? (yes/no — returning clients get their stylist offered)
3. Roughly when? (this week / next week / flexible)
4. Send booking link, or hand to a human on read-only tier

Then: push contact to GHL with `source = instagram_dm`. If no booking within 2 hours, trigger Lead
Follow-Up (Service 4.1).

## Flow 2 — WhatsApp

Same tree. Two differences that matter:

- **The 24-hour window.** Outside 24 hours from the user's last message you may only send an approved
  template. Free-form sends will fail. Every reminder in Service 4.2 is therefore a template and must
  be submitted for approval in advance.
- Templates need approval per language. Submit German and English at the same time; approval takes
  hours to days and rejections are common on first submission for anything that reads as marketing.

Templates to submit up front:
| Name | Purpose | Timing |
|---|---|---|
| `appointment_confirmation` | Booking confirmed | On booking |
| `reminder_48h` | Confirmation + reschedule link | T-48h |
| `reminder_2h` | Final nudge | T-2h |
| `noshow_followup` | Missed appointment | +30 min |
| `noshow_day3` | Second attempt, optional incentive | Day 3 |
| `review_request` | Post-visit feedback ask | +2h after completion |

## Flow 3 — Complaint interception

Runs **before** any automated reply on both channels.

Keyword and intent check for dissatisfaction — refund, complaint, terrible, ruined, damaged, allergic,
burnt, "worst", legal. On a hit:
1. Stop the automation. Send no automated answer.
2. Tag the contact `complaint`.
3. Alert the owner immediately.
4. Reply once, plainly: "I'm sorry — I'm passing this to {{owner_name}} now, someone will be in touch
   today."

This is a hard invariant, matching Service 3. An automated cheerful reply to "you burnt my hair" is
how a salon ends up on the local news.

## Handoff to human

ManyChat Live Chat. Pause automation for 24 hours whenever a human replies, so the bot does not
interrupt a real conversation. Set this — it is not the default.

## Out of hours

Do not pretend to be open. "We're closed right now, but I've got your message and someone will reply
first thing. If it's urgent, call {{phone}}." Then log a callback request.

## Testing before go-live

- [ ] DM from an account that has never messaged the business
- [ ] Story reply trigger
- [ ] Comment keyword trigger
- [ ] Each quick-reply branch
- [ ] Complaint keyword — confirm automation stops and owner is alerted
- [ ] Human handoff pauses the bot
- [ ] Out-of-hours message
- [ ] WhatsApp template send outside the 24-hour window actually delivers
- [ ] Contact lands in GHL with correct source attribution
