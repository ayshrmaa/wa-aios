# Data Processing Agreement (Template)

DRAFT — requires Swiss legal review before use.

**Controller:** {{salon_legal_name}}, {{salon_address}}
**Processor:** Work Artificial, {{wa_address}}
**Effective:** {{date}}

## 1. Roles
The Salon is the controller. Work Artificial is the processor, acting only on documented instructions.
Where Work Artificial engages sub-processors (Section 5), it does so as controller of that relationship
and remains liable to the Salon for their performance.

## 2. Subject matter and duration
Processing of client personal data for appointment booking, reminders, follow-up, customer service and
review solicitation, for the term of the Service Agreement plus the retention period in Section 7.

## 3. Categories of data subject and data
Data subjects: the Salon's clients and prospective clients.
Data: name, phone number, email address, appointment history, service preferences, stylist preference,
call recordings and transcripts, message history, review ratings and free-text feedback.

No special-category data is solicited. Where a caller volunteers health information (allergies, scalp
conditions, pregnancy), the agent transfers to a human and the information is not stored in structured
fields. Call recordings may nonetheless capture it; recordings are treated as potentially sensitive
throughout.

## 4. Instructions
Work Artificial processes only on the Salon's documented instructions, being this DPA, the Service
Agreement, and configuration set during onboarding. It notifies the Salon if an instruction appears to
breach applicable law.

## 5. Sub-processors
The Salon consents to the following, and to their sub-processors:

| Sub-processor | Function | Data | Location |
|---|---|---|---|
| Retell AI | Voice agent, recording, transcription | Call audio, transcripts | {{retell_region}} |
| OpenAI | Language model behind the agent | Transcript content | {{openai_region}} |
| ElevenLabs | Speech synthesis | Generated audio only | {{11labs_region}} |
| Google (Calendar) | Appointment storage | Name, phone, service, time | EU |
| n8n Cloud | Workflow orchestration | All of the above in transit | EU |
| Supabase | Database | All structured data | EU (Frankfurt) |
| GoHighLevel | CRM and messaging | Contact and message data | {{ghl_region}} |
| ManyChat | Instagram and WhatsApp automation | Message data | {{manychat_region}} |
| Meta (WhatsApp Business, Instagram) | Message transport | Message content | {{meta_region}} |

Work Artificial gives 30 days' notice of any change. The Salon may object; if the objection cannot be
resolved, either party may terminate the affected service without penalty.

**Open item for legal review:** several of these providers are US-headquartered. The transfer basis
(adequacy, Swiss-US Data Privacy Framework certification, or Standard Contractual Clauses with the
Swiss addendum) must be confirmed per provider and recorded here before the first client signs. Do not
leave this as boilerplate.

## 6. Security
As set out in `05-security-data-handling.md`, which forms part of this agreement.

## 7. Retention and deletion
| Data | Retention |
|---|---|
| Call recordings | 90 days, then deleted |
| Transcripts | 12 months |
| Appointment records | Term plus 24 months |
| Marketing consent records | Term plus 24 months |
| Complaint records | Term plus 24 months |

On termination, Work Artificial deletes or returns all personal data within 30 days at the Salon's
election, except where retention is legally required.

## 8. Data subject rights
Work Artificial assists the Salon in responding to access, rectification, erasure and objection
requests within 5 working days. A deletion request is executed across Postgres, GHL, Retell recordings
and transcripts, ManyChat, and Google Calendar. Partial deletion is not deletion.

## 9. Breach notification
Work Artificial notifies the Salon without undue delay and in any case within 24 hours of becoming
aware of a personal data breach, with the information the Salon needs to meet its own obligation to
notify the FDPIC.

## 10. Audit
The Salon may audit compliance once per year on 30 days' notice, or upon a breach.
