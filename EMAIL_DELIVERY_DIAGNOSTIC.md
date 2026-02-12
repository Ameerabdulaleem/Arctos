# Email Delivery Diagnostic Checklist

Follow these steps to identify why waitlist users aren't receiving emails:

---

## Step 1: Verify Vercel Environment Variables Are Set

Go to: https://vercel.com/dashboard → **arctos-fi** → Settings → **Environment Variables**

Check **Production** environment has:
- [ ] `RESEND_API_KEY` = `re_...` (your server Resend key)
- [ ] `RESEND_FROM_EMAIL` = `arctos@resend.dev`
- [ ] `RESEND_FROM_NAME` = `ARCTOS Team`
- [ ] `VITE_API_BASE` = `https://arctos-fi.vercel.app`

**If ANY are missing → Add them now and redeploy**

---

## Step 2: Check Browser Network Tab

1. Go to https://arctos-fi.vercel.app
2. Open DevTools (F12) → **Network** tab
3. Submit the waitlist form with your email
4. Look for a POST request to `/api/resend`

**Tell me:**
- ✅ Does the `/api/resend` request appear?
- What's the **Status** code? (200, 400, 404, 500?)
- What's in the **Response** tab?

---

## Step 3: Check Browser Console Tab

1. Same page, open DevTools → **Console** tab
2. Submit the waitlist form
3. Copy any **red error messages** and send them to me

---

## Step 4: Check Resend Dashboard

Go to: https://resend.com/emails

Look at recent email activity:
- [ ] Any new emails appear after you submitted?
- What's their **Status**? (Delivered ✅, Failed ❌, Bounced ⚠️)
- If **Failed**, what's the error message?

---

## Step 5: Test Direct API Call

In your browser console, run:
```javascript
fetch('https://arctos-fi.vercel.app/api/resend', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'arctosapp@gmail.com',
    position: 1,
    subject: 'Test Email',
    html: '<strong>Test</strong>',
    text: 'Test'
  })
}).then(r => r.json()).then(console.log)
```

**What response do you get?** (Copy the entire JSON response)

---

## My Diagnosis

Once you provide answers to the above, I can pinpoint the issue:

- **If Step 1 fails** → Env vars not set in production
- **If Step 2 shows 404** → `/api/resend` endpoint not deployed
- **If Step 2 shows 500** → Server-side error (check Step 5 response)
- **If Step 4 shows "Failed"** → Resend API key is wrong or Resend account issue
- **If Step 5 returns error** → API is working but something else failed

---

**Please run all 5 steps and tell me what you find.**
