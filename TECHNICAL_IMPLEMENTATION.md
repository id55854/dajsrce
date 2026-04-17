# DajSrce -- Technical Implementation Guide

Last updated: April 17, 2026  
Live: https://dajsrce.vercel.app  
Repo: https://github.com/id55854/dajsrce.git

---

## 1. Project Overview

DajSrce ("Give Heart") is a web platform connecting donors and volunteers with social
institutions (shelters, soup kitchens, childrens homes, etc.) in Zagreb, Croatia.

Core features:

- Interactive map of institutions with category filtering
- Needs board: institutions post material needs, citizens pledge donations
- Volunteer events: institutions post events, citizens sign up
- Role-based access: citizens vs institutions have different dashboards
- Proximity notifications: users within 3km get notified of new needs/events
- Location tracking: user coordinates saved on login
- Dark mode with persistent toggle
- WCAG 2.1 AA accessibility menu with 8 features
- Google OAuth and email/password authentication
- **ESG Phase 1 (2026-04):** optional EUR on pledges; institution **delivered** +
  **acknowledge** flow; Vercel-cron auto-ack after `AUTO_ACKNOWLEDGE_DAYS`;
  company **donation receipts** (PDF/XML to Supabase Storage, Resend email);
  Stripe Checkout + Customer Portal + webhook for paid tiers (`subscriptions`,
  `stripe_events`). See `CLAUDE.md` §4–§5 and migrations `005_*`, `006_*`.