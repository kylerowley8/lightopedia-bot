# Light Platform Overview

Light is a modern finance and billing platform designed for B2B SaaS companies. It handles the full quote-to-cash and procure-to-pay lifecycle.

## Core Concepts

### Accounts Receivable (AR) - Sales/Revenue Side

**Contracts**: Sales agreements with customers that define billing terms, pricing, and schedules.
- Contracts define what you're selling to customers
- Can have multiple line items with different products/services
- Support various billing frequencies (monthly, quarterly, annual, one-time)
- Contracts generate Invoice Receivables based on their schedules

**Invoice Receivables (Sales Invoices)**: Invoices sent TO customers for payment.
- Generated from contracts based on billing schedules
- Represent money owed TO your company
- Have statuses: draft, open, paid, partially_paid, voided
- Can be synced to accounting systems (QuickBooks, Xero, NetSuite)

**Customers**: Companies or individuals who buy from you.
- Linked to contracts and invoice receivables
- Can have multiple contacts
- Synced with CRM systems like Salesforce and HubSpot

**Credit Notes**: Adjustments that reduce what a customer owes.
- Applied against invoice receivables
- Used for refunds, discounts, or corrections

### Accounts Payable (AP) - Expense/Vendor Side

**Invoice Payables (Vendor/Supplier Invoices)**: Invoices received FROM vendors for payment.
- Represent money you owe TO vendors
- Support OCR/document scanning for ingestion
- Go through approval workflows
- Linked to purchase orders
- Have statuses: draft, pending_approval, approved, paid

**Vendors/Suppliers**: Companies you purchase from.
- Linked to invoice payables and purchase orders
- Track payment terms and banking details

**Purchase Orders**: Orders placed with vendors before receiving goods/services.
- Can be linked to invoice payables
- Track what was ordered vs what was invoiced

**Expenses**: Employee expenses for reimbursement.
- Card transactions and receipts
- Expense reports and approvals

## Key Workflows

### Quote-to-Cash (Revenue)
1. Create a Contract for a customer
2. Contract generates Invoice Receivables on schedule
3. Send invoice to customer
4. Receive payment
5. Mark invoice as paid
6. Revenue recognized in accounting

### Procure-to-Pay (Expenses)
1. Create Purchase Order (optional)
2. Receive Invoice Payable from vendor (via OCR or manual entry)
3. Invoice goes through approval workflow
4. Approve invoice
5. Schedule payment
6. Execute payment run
7. Mark invoice as paid

## Integrations

### CRM Integrations
- **Salesforce**: Sync accounts, contacts, opportunities. Can create contracts from closed-won opportunities.
- **HubSpot**: Sync companies, contacts, deals.

### Accounting Integrations
- **QuickBooks Online**: Sync invoices, customers, vendors, chart of accounts
- **Xero**: Similar sync capabilities
- **NetSuite**: Enterprise accounting sync

### Payment Integrations
- **Stripe**: Process card payments for invoice receivables
- **Plaid**: Bank account verification
- **Payment file exports**: Generate payment files for bank uploads

### HR/Payroll Integrations
- **Finch**: Sync employee data for expense management

## API Overview

Light provides a REST API for all operations:
- Authentication via API keys or OAuth 2.0
- JSON request/response format (camelCase)
- Pagination for list endpoints
- Webhook support for real-time updates

Common endpoints:
- `/v1/invoice-receivables` - Sales invoices
- `/v1/invoice-payables` - Vendor invoices
- `/v1/contracts` - Sales contracts
- `/v1/customers` - Customer records
- `/v1/vendors` - Vendor records
- `/v1/products` - Product catalog
