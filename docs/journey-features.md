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
