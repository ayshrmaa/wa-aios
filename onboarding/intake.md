# Client Onboarding Intake

Completed on the onboarding call, not chased afterwards. The guide is right about this: chasing a
client for credentials a week later kills momentum. Do not leave the call without it.

Target go-live: **within 2 weeks** of a completed intake.

---

## A. Business basics
- [ ] Legal entity name and registered address
- [ ] Trading name as callers would say it
- [ ] Address, canton
- [ ] Primary language: German / French / Italian / English
- [ ] Opening hours **per day** (not a single range — Thursday late nights and Monday closures are the norm)
- [ ] Annual closure dates, public holidays observed
- [ ] Owner's mobile and email for alerts

## B. Services and pricing
- [ ] Full service menu with **duration per service** and price in CHF
- [ ] Which services require a patch test or consultation first
- [ ] Which services cannot be booked by phone and must be a consultation

> Duration per service is not optional. A flat 30- or 60-minute slot will double-book a colour and
> waste an hour on a fringe trim.

## C. Staff
- [ ] Every stylist: name, services they perform, working days
- [ ] Does each stylist need their own calendar? (Almost always yes)
- [ ] What happens when a caller has no preference: round-robin / first available / named default
- [ ] Who takes transferred calls during opening hours, and on what number

## D. Phone
- [ ] Existing business number
- [ ] Carrier and account access, for call forwarding
- [ ] Forwarding mode: primary line / after-hours only / overflow when busy
- [ ] Transfer destination number
- [ ] Out-of-hours: callback request (default) or voicemail

## E. Booking system
- [ ] Current system: Google Calendar / Fresha / Booksy / Square / other / none
- [ ] **Tier assignment** — decides what we can honestly promise:

| Their system | Tier | What they get |
|---|---|---|
| Google Calendar, or none | Full | Agent books, reschedules, cancels directly |
| Fresha, Booksy | Read-only | Reminders, no-show recovery, reviews, dashboard. Agent takes booking **requests** and passes them to the front desk — it does not book. |

> Fresha has no public API. Booksy's is contact-gated. If the salon will not move to Google Calendar,
> they are read-only tier and the audit report must say so. Selling them live booking is selling
> something that does not exist.

- [ ] If Full: Google account for calendar access, one calendar per stylist
- [ ] If Read-only: confirmed in writing with the owner that the agent cannot book

## F. Knowledge base
- [ ] FAQs: parking, products used, first-visit process, cancellation policy, payment methods
- [ ] Website URL to scrape
- [ ] Anything the agent must **never** say (competitor comparisons, discounting, medical advice)

## G. Messaging
- [ ] WhatsApp Business number — dedicated, not the owner's personal
- [ ] Meta Business verification: **start on day one.** Days to weeks. This is the long pole and it
      blocks Service 5 entirely.
- [ ] Instagram Business account admin access
- [ ] Facebook Page, linked to the Instagram account
- [ ] Business email or SMTP for sending from their own domain

## H. Reviews
- [ ] Google Business Profile access
- [ ] Google review link
- [ ] Rating threshold for the public review ask (default 4)
- [ ] **Gating decision — owner must decide explicitly.** Routing only happy clients to Google
      violates Google's review policy and businesses have lost their review history for it. Default is
      off. If the owner wants it on, record that they were told.

## I. Numbers for the dashboard and audit
- [ ] Average appointment value, CHF
- [ ] Current no-show rate, if known
- [ ] Rough weekly call volume, and estimated missed calls
- [ ] Current monthly bookings

## J. Branding
- [ ] Logo, colours, fonts
- [ ] Tone: formal or informal address (Sie / du — get this wrong and it reads as rude)

## K. Compliance — all blocking
- [ ] Service Agreement signed
- [ ] DPA signed
- [ ] Recording disclosure acknowledgment signed
- [ ] Owner has published a privacy policy covering this processing

---

## Go-live checklist

- [ ] Agent called 10+ times internally. Every tool exercised. Deliberate attempts to break it.
- [ ] Disclosure confirmed playing on every test call — `disclosure_played` true, no exceptions
- [ ] Double-booking test: two simultaneous bookings on one stylist, one must fail cleanly
- [ ] Complaint test: an angry caller must get a transfer, never an automated resolution or a discount
- [ ] Reminder sequence fires at T-48h / T-24h / T-2h on a test booking
- [ ] Quiet hours respected; a T-2h landing after 21:00 is dropped, not sent late
- [ ] Dashboard shows real data
- [ ] Going-live call booked — owner calls the agent themselves, pushes it, signs off
- [ ] Call forwarding switched on together, on the call
- [ ] Invoicing set up, 30-day cycle
