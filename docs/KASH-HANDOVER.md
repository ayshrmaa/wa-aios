# AIOS — the complete picture

*For Kash. Everything that was built, how it works, and what happens next. No technical background needed. Where a technical word is unavoidable, it is explained in the glossary at the end.*

---

## 1. What this is, in one paragraph

AIOS is a system that answers a salon's phone, books appointments into the calendar, sends reminders so people turn up, chases the ones who don't, asks happy customers for a Google review, and follows up every enquiry from Instagram, WhatsApp or the website until that person books. The owner sees all of it on one dashboard. It replaces the front-desk work a salon usually can't afford to staff properly — and it never forgets to follow up.

Everything in the briefing document you wrote has been built. This document tells you what each piece does, what is working today, and what needs *you* to get it into a real salon.

---

## 2. What a customer actually experiences

The easiest way to understand the system is to follow three people through it.

**Sophie calls the salon on a Sunday evening.**
The salon is closed. The AI receptionist answers on the first ring. It tells her she is speaking to an assistant and that the call is recorded (Swiss law requires this — it is built in and cannot be switched off). She asks for a balayage with Lea on Thursday afternoon. The receptionist checks Lea's actual calendar, sees 14:00 is free, books it, and reads it back. Sophie gets an email confirmation. Two days before, she gets a WhatsApp reminder. The day before, an email. Two hours before, a final WhatsApp nudge. She turns up. Two hours after she leaves, she gets a message asking how it went — and a link to leave a Google review.

**Lara sends the salon an Instagram DM: "how much is a cut?"**
The Instagram bot answers her question, asks what she wants and when, and hands her details to AIOS. Within two minutes she gets a personal message: "thanks for getting in touch about Cut & Finish — we have openings this week, here's the booking link." If she doesn't book, she hears again the next day, then three days later, then a week later, then a fortnight later. Politely, in German, never pushy. The moment she books, the follow-ups stop. The owner sees her on the Leads page the whole time: where she came from, what she wanted, how many messages went out, when the next one is due.

**Tom books a men's cut and doesn't show up.**
Thirty minutes after his appointment time, the system notices he hasn't been marked as arrived and quietly flags it as a no-show. Half an hour later he gets a WhatsApp: "we missed you today — want to rebook?" If he doesn't answer: a message the next day, another on day three, a last one on day seven. If he rebooks, the dashboard counts it as recovered revenue. This is the number that justifies the monthly fee.

Every message respects quiet hours: nothing goes out between 21:00 and 08:00. A reminder that would land at 23:00 waits until 08:00 — except the two-hour reminder, which is dropped rather than sent late, because a reminder after the appointment is worse than none.

---

## 3. The seven services, and where each one stands

| Service from your brief | What it does for the salon | Status |
|---|---|---|
| **1. AI Receptionist** | Answers every call, books, reschedules, cancels, answers questions, passes complaints and awkward calls to a human. | **Working.** You can talk to it today from the website. |
| **2. Reporting Dashboard** | One screen: bookings, missed calls, no-shows, recovered revenue, leads by source, reviews. Plus pages for appointments, calls, leads, reviews and messages. | **Working.** Login-protected. |
| **3. AI Customer Service** | Answers the repeat questions (hours, prices, parking). Complaints are never auto-answered — they go straight to the owner. | **Working** inside the receptionist. The weekly summary email is not built yet. |
| **4.1 Lead Follow-Up** | Every enquiry from any channel gets a personal follow-up within minutes, then a polite ladder until they book. | **Working.** |
| **4.2 Appointment Reminders** | 48 hours, 24 hours, 2 hours before. No-show recovery at 30 min, day 1, day 3, day 7. | **Working.** Needs an email account connected to actually send (see section 5). |
| **5. WhatsApp + Instagram** | The DM bot and the hand-off into AIOS. | **Code is done.** Blocked by Meta — see section 7. |
| **6. Reviews & Reputation** | Asks after every visit. Tracks requests, responses, average rating. | **Working.** One decision needed from you — section 6. |
| **7. Website (upsell)** | A one-page salon site with a "talk to our receptionist" button. | **Working.** |

Also built: the audit-report generator from section 6.1 of your brief (discovery numbers in, branded PDF out), the five Swiss compliance documents as drafts, the client onboarding questionnaire, and a health-check tool that tells you in plain PASS / FAIL lines whether every part is connected.

---

## 4. Where everything lives

| | Link | What you'll see |
|---|---|---|
| **The dashboard** | https://wa-aios-dashboard-90cejxydb-ayshrmaa-9662s-projects.vercel.app | The owner's view, running on example data for a fictional Zurich salon called Atelier Nova. Click through Termine, Anrufe, Leads, Bewertungen, Nachrichten. |
| **The salon website** | https://wa-aios-site-isp70cvt0-ayshrmaa-9662s-projects.vercel.app | Press **Talk to our receptionist** and speak to it. Ask to book a balayage with Noemi. It checks a real calendar and writes a real booking. |
| **The code** | https://github.com/ayshrmaa/wa-aios | Everything, with instructions. Anyone you hire can start from here. |

The website and dashboard are hosted and permanent. The "brain" behind them — the part that books appointments — currently runs on Aayush's laptop, reachable through a temporary link. When his laptop sleeps, the receptionist can still talk but can no longer book. Moving that brain to a proper server is step 4 in section 5.

---

## 5. What you need to do to put this into a real salon

You said you'll connect the accounts yourself. Here is every one of them, in the order that makes sense. None requires writing code. Each one gives you a "key" — a long string of letters and numbers — that gets pasted into one settings file. The developer guide in the code (`api/CONFIGURATION.md`) names every key and where it goes; this section tells you *why* each exists and where to click.

### Step 1 — Describe the salon (30 minutes, with the owner)

Before anything else, collect from the salon:

- Every service, **how long it takes**, and the price in CHF. Duration matters most: it decides how much calendar the receptionist blocks. A balayage is not a fringe trim.
- Every stylist's name and which days they work.
- Opening hours for each day of the week, plus closure dates.
- The phone number that complaints and "let me speak to a person" should go to.
- Their Google review link.

The onboarding questionnaire in the code (`onboarding/intake.md`) has all of this as a form. It goes into one settings file per salon.

### Step 2 — Retell: the voice (free to start)

This is the company whose technology does the talking. **You already have this** — Aayush set it up. The agent exists and works. Cost is roughly 10 US cents per minute of conversation; the first 10 dollars are free.

What still needs doing here: a phone number. Retell only sells American and Canadian numbers. For a Swiss +41 number you need a Twilio account (twilio.com, needs a credit card, a few francs a month) and the number gets connected into Retell. Until then, the receptionist is reachable through the website button, which is honestly a better demo anyway.

### Step 3 — Google Calendar: where bookings go (free)

The salon needs one Google Calendar per stylist. The receptionist reads them to check availability and writes into them to book.

1. The salon owner's Google account: create a calendar for each stylist (Lea, Mara, …).
2. At console.cloud.google.com, create a project and turn on the "Google Calendar API". Create an "OAuth client" and copy its ID and secret.
3. Run the one-time authorisation tool in the code (`npm run google:consent`). It opens a Google page; the owner clicks Allow; it prints the key.

This one is fiddly. If it's the step that stalls you, it is the one to hand to a developer for an hour.

### Step 4 — A server for the brain (about 7 dollars a month)

The booking engine must run somewhere that never sleeps. Free hosting plans switch off after 15 minutes of quiet and take almost a minute to wake up — a caller asks for Tuesday at 2pm, the system is asleep, the call dies. A salon phone is quiet most of the day, so this would happen constantly.

Render.com, the "Starter" plan, about 7 dollars a month. The setup file is already in the code. This is the one thing on the list that costs money and cannot be avoided.

### Step 5 — Supabase: the database (free)

Where all appointments, leads, calls and messages are stored. supabase.com, new project, **choose the Frankfurt region** — Swiss data protection law expects data to stay in Europe. Copy the "connection string" from Settings → Database.

### Step 6 — Resend: sending email (free up to 3,000 a month)

Reminders, review requests and owner alerts go by email. resend.com, add the salon's domain, copy the API key. Without this, messages are prepared and logged but never leave. The dashboard shows them as "Simuliert" (simulated) so you can see exactly what would have gone out.

### Step 7 — Meta: Instagram and WhatsApp (free, but slow)

See section 7. Start this on day one of every salon because it is the slowest thing on the list and nothing you do speeds it up.

### Step 8 — Turn it on

Once the keys are in, the health-check tool (`npm run doctor`) checks everything: is the voice connected, does it reach the booking engine, is the calendar authorised, will emails send. Every line says PASS, WARN or FAIL in plain words. When they all pass, the salon is live.

---

## 6. Three decisions only you can make

**Review gating.** Your brief says: send happy customers to Google, send unhappy ones to a private form. That is called review gating and it is against Google's rules. Businesses have had their entire review history deleted for it. The feature is built and switched **off**. If you want it on, the salon should be told in writing what they're accepting. My recommendation: leave it off, ask everyone, and let the complaint alert do the protecting.

**What to promise Fresha and Booksy salons.** Your brief lists Fresha and Booksy as things to connect to. Neither company lets outside software book into their system — Fresha has no public way in at all, Booksy only for approved partners. So this system does not *connect* to them; it *replaces* them, with Google Calendar. A salon that wants to stay on Fresha can still have reminders, no-show recovery, reviews and the dashboard — but the receptionist will take booking *requests* for the front desk to enter, rather than booking live. Be honest about that at the point of sale. The audit report should say which of the two the prospect is getting.

**The legal documents.** Five are drafted: the recording disclosure, the data processing agreement, the privacy policy, the service agreement, and the security policy. They are consistent and complete, but they were written by software, not a Swiss lawyer. A lawyer must read them before the first salon signs. This is the cheapest thing on the list and the most expensive to skip.

---

## 7. What is not done, and why more work won't fix it

**WhatsApp and Instagram.** The code is finished on both sides. But Meta must verify the salon as a business — a real legal entity, documents uploaded, days to weeks of waiting — and then separately approve every message template the system sends. You cannot verify a business that hasn't signed yet. So this waits for client number one. Start the application the day they sign.

**A Swiss phone number.** Retell doesn't sell them. Twilio does, with a credit card, then it's connected through. A short task for a developer; not a today task.

**Hosting the brain.** Section 5, step 4. Seven dollars a month. Until it's done, the live demo depends on Aayush's laptop being awake.

**The weekly customer-service summary email** from Service 3. Not built. Everything it would summarise is already recorded, so it is a small addition, not a gap in the foundation.

---

## 8. What it costs to run, per salon

| | Monthly |
|---|---|
| Voice (Retell) | ~10 cents per minute of calls. A salon taking 300 calls of 3 minutes: ~90 dollars |
| Phone number (Twilio) | a few francs |
| Server (Render) | ~7 dollars |
| Database (Supabase) | free at this size |
| Email (Resend) | free to 3,000 a month |
| Instagram bot (ManyChat) | ~15 dollars, once Meta clears |
| Dashboard and website hosting (Vercel) | free |

Roughly 100 to 150 dollars a month in tools per salon, dominated by call minutes. Everything else is your margin.

---

## 9. Sending this to a developer

If you bring someone in, send them the GitHub link and tell them: *start with README.md, then "Install into a new business" in api/CONFIGURATION.md.* It is ten steps, every one a command. `npm test` runs thirty automated checks against a live copy of the system — if those pass, the core works. They do not need to talk to Aayush to get started.

---

## Glossary

**API key** — a long password that lets one piece of software use another. You get one from each service (Retell, Google, Resend…) and paste it into a settings file. Never post it anywhere public.

**Webhook** — a web address that one system calls to tell another something happened. When the receptionist wants to book, it calls a webhook on the booking engine.

**Server / hosting** — a computer somewhere that runs the software 24 hours a day. Your laptop is not one, because it sleeps.

**Database** — where the data lives: appointments, contacts, messages, calls.

**Tunnel** — a temporary public address pointing at a program on a laptop. Fine for demos, dies when the laptop sleeps. Replaced by hosting.

**Meta Business verification** — Facebook/Instagram/WhatsApp checking that a business is real before letting software message people on its behalf. Slow, unavoidable, needs a legal entity.

**No-show inference** — the system deciding someone didn't turn up because their appointment time passed 30 minutes ago and nobody marked them as arrived.

**Quiet hours** — 21:00 to 08:00. No outbound messages, no exceptions.

**Recovered revenue** — appointments that were no-shows and then rebooked, multiplied by the average appointment value. An estimate, labelled as one on the dashboard.

**Review gating** — steering only happy customers toward public reviews. Against Google's policy. Off by default.
