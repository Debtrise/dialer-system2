# Journey Features

The journey module automates follow-up steps for leads. Supported action types are:

- **call** – place outbound calls with transfer group support
- **sms** – send templated SMS messages via Twilio or Meera
- **email** – deliver templated email messages
- **status_change** – update the lead's status field
- **tag_update** – add or remove tags on a lead
- **webhook** – POST data to external systems
- **delay** – pause for a specified period before the next step

Action types previously listed but not yet implemented have been removed from the models.

## Day-based Journeys

Journeys can repeat the same set of steps for multiple days. Each step may be
marked with `isDayEnd` to indicate the end of a day. When a journey record
reaches a step marked as the day end, the `dayCount` stored in the journey's
context is incremented. If the parent `Journey` specifies `repeatDays`, the
steps start over from the beginning until the day count exceeds this value.
