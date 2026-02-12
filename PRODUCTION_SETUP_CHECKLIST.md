# Production Setup Checklist for ARCTOS Waitlist

This guide will walk you through getting Vercel + GitHub + Resend configured for production email sending.

---

## Step 1: Gather Vercel Credentials (5 mins)

### 1a. Get Project ID
1. Go to https://vercel.com/dashboard
2. Click on your **arctos-fi** (or similar) project
3. Click **Settings** (top right)
4. Look for **Project ID** on the General tab
5. Copy it (looks like: `prj_abc123xyz`)

### 1b. Get Team/Organization ID
1. Go to https://vercel.com/account/teams
2. Find your team name (or "Personal")
3. Copy the **Team/Org ID** (looks like: `team_abc123xyz`)
   - If no team, use your personal account ID

### 1c. Create Vercel Token
1. Go to https://vercel.com/account/tokens
2. Click **Create Token**
3. Name it: `arctos-github-deploy`
4. Expiration: 90 days (or permanent)
5. Scope: Make sure you can redeploy projects
6. Click **Create**
7. **Copy the token immediately** (looks like: `vercel_xxx...`) — it won't show again!

**You now have:**
- ✅ Project ID
- ✅ Team/Org ID
- ✅ Vercel Token

---

## Step 2: Add GitHub Secrets (3 mins)

These tell GitHub how to deploy to Vercel.

### Where to go:
1. Go to Your Repo → Settings (top menu, not project settings)
2. Click **Secrets and variables** → **Actions** (left sidebar)
3. Click **New repository secret**

### Add these 3 secrets:

| Secret Name | Value | Notes |
|---|---|---|
| `VERCEL_TOKEN` | Paste the token from Step 1c | The long string starting with `vercel_` |
| `VERCEL_PROJECT_ID` | Paste the ID from Step 1a | Looks like `prj_abc123xyz` |
| `VERCEL_ORG_ID` | Paste the ID from Step 1b | Looks like `team_abc123xyz` or your user ID |

**After each:**
- Paste value in the **Value** field
- Click **Add secret**
- You should see ✅ next to each one

---

## Step 3: Add Vercel Environment Variables (3 mins)

These tell Vercel how to send emails and where the frontend calls the API.

### Where to go:
1. Go to https://vercel.com/dashboard
2. Click your **arctos-fi** project
3. Click **Settings** (top)
4. Click **Environment Variables** (left sidebar)
5. Make sure you're adding to **Production** environment (dropdown at top)

### Add these 4 variables:

| Variable Name | Value | Notes |
|---|---|---|
| `RESEND_API_KEY` | `re_9nbkT8zh_FMXHb2u9851dm4fvhUUyHGDy` | Your actual Resend server key (starts with `re_`) |
| `RESEND_FROM_EMAIL` | `arctos@resend.dev` | For now (will change if you verify a custom domain) |
| `RESEND_FROM_NAME` | `ARCTOS Team` | Sender name |
| `VITE_API_BASE` | `https://arctos-fi.vercel.app` | Your actual Vercel URL (change if different) |

**For each:**
1. Click **Add New** 
2. Paste name in **Name** field
3. Paste value in **Value** field
4. Make sure **Production** is selected
5. Click **Save**

You should see 4 env vars listed after this.

---

## Step 4: Deploy to Production (1 min)

### Via GitHub (automatic):
```bash
git add .
git commit -m "chore: production setup complete"
git push origin main
```

This automatically:
- Deploys to Vercel
- Sets VITE_API_BASE automatically

Or manually redeploy:
1. Go to Vercel dashboard
2. Click your project
3. Click **Redeploy** button (top right)

**Wait 30-60 seconds for deployment to finish.**

---

## Step 5: Verify Production Works (2 mins)

### Test the welcome email:

1. Go to https://arctos-fi.vercel.app (your actual URL)
2. Click **Join Waitlist**
3. Enter: `arctosapp@gmail.com` (your test email)
4. Submit

### Check for email:

- Go to https://resend.com/emails
- You should see a new email with status ✅ **Delivered**
- Check your email inbox
- You should receive the **full welcome email** (with position, features, etc.)

**If you see just "Test email" — something is wrong, contact me.**

---

## Troubleshooting

### "Cannot GET /api/resend"
- ❌ Vercel deploy didn't work
- ✅ Re-check: Is `api/resend/route.ts` at project root? Deploy again.

### "Missing RESEND_API_KEY"
- ❌ Env var not set in Vercel
- ✅ Go to Vercel Settings → Environment Variables → check Production tab

### No email received
- ❌ Resend API key is wrong or email limit reached
- ✅ Check Resend dashboard for error: https://resend.com/emails

### Workflow failed to deploy
- ❌ GitHub secrets missing or Vercel token expired
- ✅ Check GitHub Actions tab → recent run → see error logs

---

## Quick Reference: URLs

| Service | URL | What to do |
|---|---|---|
| GitHub Secrets | https://github.com/YOUR-ORG/arctos/settings/secrets/actions | Add VERCEL_TOKEN, VERCEL_PROJECT_ID, VERCEL_ORG_ID |
| Vercel Env Vars | https://vercel.com/dashboard → arctos-fi → Settings → Environment Variables | Add RESEND_API_KEY, RESEND_FROM_EMAIL, VITE_API_BASE |
| Vercel Tokens | https://vercel.com/account/tokens | Create new token |
| Resend Dashboard | https://resend.com/emails | Check if emails delivered |
| Your Live App | https://arctos-fi.vercel.app | Test registration |

---

## Done? Checklist

- [ ] GitHub Secrets added (3)
- [ ] Vercel Env Vars added (4)
- [ ] Pushed to main (or manually redeployed)
- [ ] Waited 60 seconds for deploy
- [ ] Tested with arctosapp@gmail.com
- [ ] Received welcome email
- [ ] Ready for real users ✅

---

**Questions?** Let me know which step is confusing and I'll help!
