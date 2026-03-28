# ODPulse

**MFI Group OD Recovery Tracker for NBFC Operations**

ODPulse is a lightweight, mobile-first web application built for NBFC field officers and head office management to track Group Overdue (OD) recovery on MFI (Microfinance) loans. Designed for teams operating across branches in Tamil Nadu.

---

## What It Does

ODPulse solves a simple but critical problem: tracking how much overdue money is being recovered from MFI group loan customers, and giving management a clear picture — branch-wise and month-wise.

**For field officers (mobile):** Enter group OD collection details on the go — customer info, contribution amounts, and group member details.

**For head office (desktop/mobile):** Monitor recovery progress through an interactive dashboard with drill-down views by branch and month.

---

## Features

### Data Entry
- Customer details: name, ID, loan account number, branch
- Financial fields: Group OD amount, customer contribution, customer OD amount
- Auto-captured date and time (editable for backdating)
- **Group member management** — "Add Person" button to add multiple group OD customers per entry, with branch auto-populated from the main form
- Form validation and success notifications

### Dashboard
Three interactive summary cards:

1. **Total Group OD Recovered** — Overall recovery amount with donut chart. Click to open a full data table (searchable, filterable by branch/date, sortable columns).

2. **GOD Recovered by Branch** — Bar chart showing branch-wise recovery. Click any branch to drill down into its monthly split.

3. **GOD Recovered by Month** — Trend chart showing month-over-month recovery. Click any month to drill down into its branch-wise split.

### Design
- Mobile-first responsive layout (works on 360px+ screens)
- Indian number formatting (₹ / lakhs)
- Clean teal/blue professional theme
- Smooth transitions and drill-down animations

---

## Branches

| Code | Branch      |
|------|-------------|
| CBE  | Coimbatore  |
| NMKL | Namakkal    |
| HSR  | Hosur       |
| PLN  | Pollachi    |
| TPR  | Tirupur     |
| MDR  | Madurai     |
| SLM  | Salem       |
| ERD  | Erode       |

---

## Tech Stack

- **Single HTML file** — no build step, no framework dependencies
- **Chart.js 4.4.1** (CDN) for interactive charts
- **Vanilla JavaScript** for all logic and state management
- **CSS** with custom properties for theming
- In-memory data store (sample data pre-loaded)

---

## Getting Started

1. Open `index.html` in any modern browser.
2. The dashboard loads by default with sample data (~30 entries).
3. Switch to the **Entry** tab to add new records.
4. Use the **Dashboard** tab to monitor recovery progress.

---

## Project Structure

```
odpulse/
└── index.html    # Complete application (HTML + CSS + JS)
```

---

## Roadmap

- [ ] Backend API with database persistence
- [ ] User authentication (field officer vs. management roles)
- [ ] DPD (Days Past Due) bucket aging analysis
- [ ] Export to Excel / PDF
- [ ] Push notifications for recovery targets
- [ ] Gold loan and LAP loan modules

---

## License

Internal use — proprietary.
