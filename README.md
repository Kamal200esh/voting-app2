# Student Council Voting App — Multi-Position Edition

A complete voting application where one voter can cast votes across multiple positions (e.g. President, Vice-President, Secretary), each with 2–3 candidates.

## Quick start

```bash
node server.js
```

Requires **Node.js ≥ 22.5.0** (uses `node:sqlite` built-in).

- Voter ballot:  http://localhost:3000
- Admin panel:   http://localhost:3000/admin.html

Default admin: **username:** `admin` | **password:** `admin123`  
*(Change via the database or by adding a new admin programmatically.)*

---

## What's new in this version

### Multiple positions
- Admins create positions (President, Vice-President, Secretary, Treasurer, etc.) from the new **Positions** tab.
- Each candidate is assigned to exactly one position.
- Default positions seeded: President, Vice President, Secretary.

### One ballot for all positions
- Voters select **one candidate per position** on a single ballot page.
- A live progress bar shows how many positions have been filled.
- The ballot can only be submitted when all positions have a selection.

### Confirmation & receipt
- A modal shows the full ballot review before submission.
- The thank-you receipt lists every position and chosen candidate.

### Results by position
- The admin Results tab shows candidate bars grouped by position.
- The leading candidate per position is highlighted in green.

---

## How to set up an election

1. **Sign in** to the admin panel.
2. Go to **Positions** → add each office (e.g. President, Vice President, Secretary).
3. Go to **Candidates** → for each candidate, pick their position, enter their name and optional party/tagline, and optionally upload a photo.
4. Go to **Voters** → register each eligible student with their ID and name.
5. Go to **Settings** → set the election title and toggle voting open.
6. Share `http://<your-host>/` with voters.

## File structure

```
voting-app-multipos/
├── server.js          # HTTP server & all API routes
├── package.json
├── db/
│   └── database.js    # SQLite schema, seed data, password hashing
└── public/
    ├── index.html     # Voter-facing ballot (multi-position)
    ├── admin.html     # Admin dashboard
    └── styles.css     # Shared design system
```
