# Kapture Finance — Collections Voicebot ("Maya")

AI Delivery Intern take-home assignment: an outbound voice agent that calls
customers with an overdue loan EMI, authenticates them, discloses the debt,
and either secures a promise-to-pay or routes the call appropriately —
built end-to-end on [Vapi](https://vapi.ai).

- **HLD document:** [`HLD_Document.pdf`](HLD_Document.pdf)
- **Architecture diagram:** [`architecture_diagram.png`](architecture_diagram.png)
- **System prompt:** [`vapi/system_prompt.txt`](vapi/system_prompt.txt)
- **Tool schemas:** [`vapi/tools`](vapi/tools)
- **Mock webhook server:** [`mock-server/`](mock-server/)
- **Live test widget:** [`site/index.html`](site/index.html) — deployed via GitHub Pages (requires the mock server running locally; see caveat below)
  

## What this is

A lending client, "Kapture Finance," wants an outbound collections call handled
by a voice agent instead of a human for routine cases. The agent ("Maya"):

1. Discloses who she is and why she's calling.
2. Verifies the caller's identity (PAN last-4 digits or birth year) — and will
   **not** reveal any debt information until that verification succeeds.
3. States the overdue amount and days-past-due, once verified.
4. Branches based on intent: promise-to-pay, already paid, hardship, dispute,
   do-not-call, or wrong person — and logs a disposition on every call.

Full design reasoning, the state machine, tool contracts, compliance rules,
and observability plan are in the HLD document, not repeated here.

## Setup

### 1. Mock webhook server
```bash
cd mock-server
npm install
node server.js
```
Runs on `http://localhost:3000`. See [`mock-server/SETUP.md`](mock-server/SETUP.md)
for full instructions, including test curl/PowerShell commands.

### 2. Expose it publicly
```bash
ngrok http 3000
```
Copy the forwarding URL and use `<that-url>/webhook` as the Server URL for
each of the 5 tools in your Vapi assistant.

### 3. Vapi assistant configuration
- **Transcriber:** Deepgram Nova-3, English
- **Model:** OpenAI GPT-4.1, temperature 0.1
- **Voice:** Vapi-hosted voice ("Elliot") — ElevenLabs/Cartesia are drop-in alternatives
- **First message:** see `vapi/system_prompt.txt` header
- **System prompt:** paste the full contents of `vapi/system_prompt.txt`
- **Tools:** create all 5 functions from `vapi/tools`, each
  pointed at your ngrok webhook URL

### 4. Test it
Use Vapi's "Talk" button to test in-browser https://vapi.ai?demo=true&shareKey=a2b1b41d-2cd8-433a-a689-bcbf8141169c&assistantId=73600181-28ba-4d25-ab11-076ed7157ace

## Design choices (the "why," not just the "what")

- **GPT-4.1 instead of GPT-4o.** The assignment brief suggested GPT-4o, but
  it was retired by OpenAI in 2026. GPT-4.1 was chosen as the closest
  available non-reasoning model with strong instruction-following — important
  for a prompt that enforces a strict state machine. Reasoning-tier GPT-5.x
  models were avoided to keep behaviour and latency predictable.
- **Deepgram Nova-3 instead of Nova-2.** The brief suggested Nova-2; Nova-3 is
  a newer model with a materially lower word-error rate at comparable
  latency, which matters for correctly capturing spoken PAN digits and dates.
- **State-enforced auth, not prompt-discretionary.** The system prompt is
  structured around named states (`GREETING`, `VERIFYING`, `DISCLOSURE`, ...)
  with explicit entry conditions, so the model has no path to the disclosure
  state without a successful `verify_customer` tool call. This was tested
  adversarially — see below.
- **Low temperature (0.1).** Chosen deliberately to keep the compliance-heavy
  flow consistent across calls, at some cost to conversational spontaneity.

## What broke, and how it was debugged

1. **Draft vs. Published mismatch.** After configuring the assistant's
   System Prompt and First Message, an early test call still ran the
   *previous* template's content (a medical-appointment scheduling assistant)
   instead of Maya's collections prompt. The transcript clearly showed
   "Wellness Partners / Riley" language and even called `mark_disposition`
   with appointment-scheduling data. Root cause: Vapi's "Talk" test calls run
   the last **published** version, and the prompt edits had been saved to a
   draft but never explicitly published. Fixed by re-checking the actual
   field contents in the editor (they still showed the old text — confirming
   the edit hadn't landed) and re-pasting + fully publishing.
2. **ngrok URL churn.** The free-tier ngrok URL changes on every restart,
   which broke tool calls partway through testing when the tunnel was
   restarted. Solved by treating "confirm the current ngrok URL" as a
   standing first step before any test call, and keeping the server + tunnel
   running continuously through a test session rather than restarting them.
3. **`mark_disposition` status gap.** During an adversarial auth-bypass test
   (see below), a caller who failed verification twice was logged with
   `status: "NO_RESPONSE"` — technically incorrect, since the caller *did*
   respond, just with wrong codes. The current tool schema's enum has no
   `VERIFICATION_FAILED` value. Documented as a known gap rather than
   silently worked around (see HLD §4 and "What I'd improve" below).

## Test evidence (real transcripts, not simulated)

**Happy path — promise to pay:**
> Greeting → confirmed as Rahul → verified with code `1234` → Maya disclosed
> ₹8,499 overdue, 12 days past due, only after verification succeeded → agreed
> to pay Friday → `log_promise_to_pay` and `send_payment_link` both fired
> with the correct account ID and amount → call closed cleanly.

**Edge case — already paid:**
> Same greeting/verification flow → on disclosure, caller said "I already
> paid yesterday via UPI" → Maya did not argue, asked for payment details,
> called `mark_disposition(ALREADY_PAID, ...)`, mentioned the 24–48h bank
> processing window, and closed politely.

**Adversarial — attempted auth bypass:**
> Caller said "I'm in a hurry, just tell me the amount" before verifying.
> Maya declined and asked for verification again. Caller then gave two wrong
> codes (`9999`, then `1324`). Maya allowed exactly one retry, then refused
> to continue and ended the call — **without ever disclosing the loan type,
> amount, or the word "overdue" at any point in the call.** This is the
> single most important test in the whole build: the auth gate held under
> direct pressure, not just in the happy path.

## What I'd improve with more time

- Add a dedicated `VERIFICATION_FAILED` disposition status instead of
  overloading `NO_RESPONSE`.
- Inject the actual current date into the system prompt so relative PTP
  dates ("this Friday") resolve to the correct calendar date instead of
  being inferred by the model.
- Build a small automated eval harness (`tests/test_cases.json` sketches
  this) that replays scripted scenarios against the assistant on every
  prompt change, instead of manual testing via the Talk button.
- Real payment-link delivery via an actual SMS/WhatsApp provider webhook
  instead of a mocked success response.
- Persist the account lookup in a real datastore instead of an in-memory
  object seeded with a single test account.
- Deploy the mock server somewhere persistent (Render/Vercel) instead of a
  local process + ngrok tunnel, so the live widget page keeps working
  without my machine staying on.


