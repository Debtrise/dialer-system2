module.exports = {
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
  twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER,
  smsRateLimit: {
    perHour: parseInt(process.env.SMS_RATE_LIMIT_PER_HOUR || '60'), // Default: 60 SMS per hour
    concurrentJobs: parseInt(process.env.SMS_CONCURRENT_JOBS || '5') // Default: 5 concurrent SMS jobs
  },
  templates: {
    default: "Hi {{name}}, this is a message from {{company}}. {{message}}",
    reminder: "Hi {{name}}, just a reminder about your upcoming appointment with {{company}}.",
    followUp: "Hi {{name}}, thank you for your interest in {{company}}. Would you like to schedule a call?"
  }
};
