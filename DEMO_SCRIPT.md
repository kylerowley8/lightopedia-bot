# Lightopedia Demo Script

## Canonical Test Questions

These questions are designed to test the bot's ability to answer from indexed documentation.

### 1. Integration Questions
- **"How does Light integrate with Salesforce?"**
  - Expected source: `docs/integrations/salesforce.md` or similar
  - Should explain: connector setup, supported objects, sync direction

- **"What CRMs does Light support?"**
  - Expected source: `docs/integrations/` folder
  - Should list: supported CRM platforms

### 2. Architecture/Technical Questions
- **"How does Light handle real-time sync?"**
  - Expected source: `docs/architecture/` or `docs/concepts/`
  - Should explain: sync mechanism, latency, conflict resolution

- **"What happens if a sync fails?"**
  - Expected source: `docs/troubleshooting/` or `docs/concepts/`
  - Should explain: retry logic, error handling, notifications

### 3. Product Capabilities
- **"Does Light handle usage-based billing?"**
  - Expected source: `docs/features/billing.md` or similar
  - Should clarify: what Light does vs doesn't do

- **"What systems does Light replace vs integrate with?"**
  - Expected source: `docs/overview.md` or `README.md`
  - Should clarify: Light's role in the stack

### 4. Sales-Ready Questions
- **"What makes Light different from Fivetran?"**
  - Expected source: `docs/comparisons/` or marketing docs
  - Should provide: differentiation points

## Expected Response Quality

Each answer should include:
1. **Short Answer** - Direct 1-2 sentence response
2. **How It Works** - Technical explanation if applicable
3. **What Light Does vs Doesn't Do** - Clear boundaries
4. **Summary** - Sales-ready one-liner
5. **Sources** - File paths that backed the answer
6. **Request ID** - For audit trail

## Low Confidence Scenarios

If the bot responds with "I don't see this covered in the current docs/code", that's correct behavior when:
- The topic isn't documented
- The documentation is too sparse
- The similarity scores are too low

## Testing Checklist

- [ ] Index repos: `light-space/axolotl`, `light-space/mobile-app`, `light-space/light`
- [ ] Verify `/healthz` returns `ok`
- [ ] Test each canonical question via @mention
- [ ] Verify sources footer appears
- [ ] Check `/debug/last-answers` shows logged questions
- [ ] Confirm thread-only replies work
