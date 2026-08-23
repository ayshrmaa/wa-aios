# AI Recording & Disclosure Script

The single most important compliance control in the system. It is spoken as the first thing on every
call, before the caller says anything of substance.

## Why it is mandatory

Two separate obligations stack here:

1. **Recording.** Under Swiss law, recording a conversation without the knowledge of all parties is a
   criminal matter (StGB Art. 179ter), not merely a data-protection one. The business-transaction
   context does not remove the need to inform.
2. **Disclosing the AI.** A caller is entitled to know they are not speaking to a person. Beyond the
   legal position, a caller who discovers mid-call that they were talking to a machine reacts badly,
   and that reaction lands on the salon, not on us.

Both are satisfied in one sentence at the top of the call.

## The line

English:
> "Thanks for calling {{salon_name}}. Just so you know, you're speaking with an automated assistant
> and this call is recorded. How can I help you today?"

German:
> "Willkommen bei {{salon_name}}. Zur Information: Sie sprechen mit einem automatisierten Assistenten,
> und dieses Gespräch wird aufgezeichnet. Wie kann ich Ihnen helfen?"

French:
> "Merci d'appeler {{salon_name}}. Pour information, vous parlez avec un assistant automatisé et cet
> appel est enregistré. Comment puis-je vous aider ?"

Italian:
> "Grazie per aver chiamato {{salon_name}}. Le comunico che sta parlando con un assistente automatico
> e che questa chiamata viene registrata. Come posso aiutarla?"

## Implementation rules

- The line lives in the Retell agent's `begin_message`. It is not something the model may choose to
  skip, shorten, or paraphrase — it is spoken before the model takes a turn.
- The system prompt instructs the agent never to repeat it, and to confirm plainly if asked.
- `disclosure_played` is captured in post-call analysis and written to `calls.disclosure_played`.
- **Any call where `disclosure_played` is false is flagged for review.** This is the tripwire. If the
  flag starts firing, calls stop until it is fixed.
- If a caller objects to being recorded: the agent transfers to a human. Do not continue an
  AI-handled recorded call over an objection.

## What the client must sign

Before go-live the salon owner signs an acknowledgment confirming:
- they have been shown the exact disclosure wording,
- they understand it plays on every call and cannot be disabled,
- they accept that disabling it would put the salon, as data controller, in breach.

This acknowledgment is listed as REQUIRED in the onboarding checklist for good reason: the salon is
the controller. The legal exposure is theirs, and they need to have seen the words.
