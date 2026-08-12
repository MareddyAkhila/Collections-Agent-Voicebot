try {
  require('dotenv').config();
} catch (_) {
  // dotenv is optional — server works fine with plain env vars / defaults.
}
const express = require('express');
const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// MOCK "DATABASE" — one seeded account matching the assignment's scenario.
// In a real system this would be a lookup against the loan servicing DB.
// ---------------------------------------------------------------------------
const ACCOUNTS = {
  'ACC-88392': {
    account_id: 'ACC-88392',
    customer_name: 'Rahul Sharma',
    loan_type: 'Personal Loan',
    overdue_amount: 8499,
    dpd: 12,
    // Either of these should verify the customer.
    valid_verification_codes: ['1234', '1995'],
    mobile_last4: '9821',
  },
};

// Simple in-memory call log so you can show "observability" in your demo.
const CALL_LOG = [];

function maskName(name) {
  if (!name) return 'Unknown';
  const parts = name.split(' ');
  return parts
    .map((p, i) => (i === 0 ? p : p[0] + '*'.repeat(Math.max(p.length - 1, 1))))
    .join(' ');
}

function logEvent(event) {
  const entry = { ts: new Date().toISOString(), ...event };
  CALL_LOG.push(entry);
  // eslint-disable-next-line no-console
  console.log('[EVENT]', JSON.stringify(entry));
}

// ---------------------------------------------------------------------------
// TOOL HANDLERS
// ---------------------------------------------------------------------------
function handleVerifyCustomer(args) {
  const account = ACCOUNTS[args.account_id];
  if (!account) {
    logEvent({ tool: 'verify_customer', account_id: args.account_id, result: 'NO_ACCOUNT' });
    return { verified: false, message: 'No account found for this ID.' };
  }

  const codeMatches = account.valid_verification_codes.includes(
    String(args.verification_code || '').trim()
  );

  logEvent({
    tool: 'verify_customer',
    account_id: args.account_id,
    customer: maskName(account.customer_name),
    result: codeMatches ? 'VERIFIED' : 'FAILED',
  });

  if (!codeMatches) {
    return { verified: false, message: 'Verification failed. Incorrect code.' };
  }

  return {
    verified: true,
    message: 'Identity verified successfully.',
    // Only return what the LLM actually needs post-verification.
    customer_name: account.customer_name,
    loan_type: account.loan_type,
    overdue_amount: account.overdue_amount,
    dpd: account.dpd,
  };
}

function handleLogPromiseToPay(args) {
  const ptpId = `PTP-${Math.floor(1000 + Math.random() * 9000)}`;
  logEvent({
    tool: 'log_promise_to_pay',
    account_id: args.account_id,
    ptp_id: ptpId,
    ptp_date: args.ptp_date,
    amount: args.amount,
  });
  return {
    success: true,
    ptp_id: ptpId,
    confirmed_date: args.ptp_date,
    amount: args.amount,
  };
}

function handleSendPaymentLink(args) {
  logEvent({
    tool: 'send_payment_link',
    account_id: args.account_id,
    channel: args.channel,
  });
  return {
    success: true,
    message: `Payment link sent successfully via ${args.channel} to registered mobile number ending ${
      ACCOUNTS[args.account_id]?.mobile_last4 || 'XXXX'
    }.`,
    link: 'https://pay.kapturefinance.mock/abcd1234', // mock link, not a real endpoint
  };
}

function handleEscalateToAgent(args) {
  logEvent({
    tool: 'escalate_to_agent',
    account_id: args.account_id,
    reason: args.reason,
  });
  return {
    success: true,
    escalation_id: `ESC-${Math.floor(1000 + Math.random() * 9000)}`,
    message: 'Escalated to human agent queue.',
  };
}

function handleMarkDisposition(args) {
  logEvent({
    tool: 'mark_disposition',
    account_id: args.account_id,
    status: args.status,
    notes: args.notes || '',
  });
  return {
    success: true,
    disposition_logged: args.status,
    timestamp: new Date().toISOString(),
  };
}

const TOOL_HANDLERS = {
  verify_customer: handleVerifyCustomer,
  log_promise_to_pay: handleLogPromiseToPay,
  send_payment_link: handleSendPaymentLink,
  escalate_to_agent: handleEscalateToAgent,
  mark_disposition: handleMarkDisposition,
};

// ---------------------------------------------------------------------------
// MAIN WEBHOOK ENDPOINT — Vapi posts tool-calls here.
// ---------------------------------------------------------------------------
app.post('/webhook', (req, res) => {
  const { message } = req.body || {};

  if (!message) {
    return res.status(200).json({ status: 'acknowledged' });
  }

  if (message.type === 'tool-calls') {
    const results = (message.toolCalls || []).map((toolCall) => {
      const { name, arguments: args } = toolCall.function;
      const callId = toolCall.id;
      const handler = TOOL_HANDLERS[name];

      let result;
      if (!handler) {
        result = { success: false, message: `Unknown function call: ${name}` };
      } else {
        try {
          result = handler(args || {});
        } catch (err) {
          console.error(`Error handling ${name}:`, err);
          result = { success: false, message: 'Internal mock server error.' };
        }
      }

      return { toolCallId: callId, result: JSON.stringify(result) };
    });

    return res.status(200).json({ results });
  }

  // Other Vapi event types (status-update, end-of-call-report, etc.)
  if (message.type === 'end-of-call-report') {
    logEvent({ event: 'call_ended', summary: message.summary || null });
  }

  return res.status(200).json({ status: 'acknowledged' });
});

// Simple endpoint to eyeball the call log while debugging / in your demo.
app.get('/logs', (_req, res) => {
  res.status(200).json(CALL_LOG);
});

app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Kapture Mock Collections Webhook Server running on port ${PORT}`);
  console.log(`Webhook URL to register in Vapi: http://localhost:${PORT}/webhook`);
  console.log(`(expose via ngrok before pasting into Vapi: ngrok http ${PORT})`);
});
