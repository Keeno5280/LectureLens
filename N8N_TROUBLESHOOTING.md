# n8n → Supabase Integration Troubleshooting Guide

## Problem: Frontend Shows "Processing Failed" Despite Successful n8n Processing

This guide helps you diagnose and fix the disconnect between your n8n workflow and frontend display.

---

## 🔥 **ROOT CAUSE IDENTIFIED AND FIXED!**

**Your n8n workflow was setting `processing_status = "complete"` (8 chars) but frontend expects `"completed"` (9 chars)**

### ✅ What Has Been Fixed:
1. **Database Migration Applied** - All existing "complete" values updated to "completed"
2. **Auto-Correction Trigger** - Any future "complete" values automatically corrected to "completed"
3. **Realtime Updates Enabled** - Frontend now receives instant updates from Supabase
4. **Status Validation** - Only valid status values allowed (pending, processing, completed, failed)

### 🔧 What You Need to Do:
**Update your n8n workflow** to use the correct spelling going forward. See instructions below.

---

## ✅ Solution Checklist

### 1. Update Your n8n Workflow Status Value (CRITICAL!)

**Problem:** n8n is setting `processing_status = "complete"` instead of `"completed"`

**⚠️ IMPORTANT:** The database will now auto-correct this, but please fix your n8n workflow!

**Check your n8n PATCH request body:**
```json
{
  "processing_status": "completed",  ← MUST be "completed" (with 'd')
  "summary_overview": "{{ $json.summary_overview }}",
  "key_points": {{ JSON.stringify($json.key_points) }},
  "important_terms": {{ JSON.stringify($json.important_terms) }},
  "flashcards": {{ JSON.stringify($json.flashcards) }},
  "processed_at": "{{ new Date().toISOString() }}"
}
```

**Valid status values:**
- `"pending"` - Initial state after upload
- `"processing"` - While n8n is working
- `"completed"` - Successfully processed (THIS IS WHAT YOU NEED)
- `"failed"` - Processing error

---

### 2. Verify Supabase URL and Authentication

**Check your n8n HTTP Request node:**

**URL Format:**
```
https://YOUR_PROJECT_ID.supabase.co/rest/v1/lectures?id=eq.{{ $json.id }}
```

**Headers:**
```
Authorization: Bearer YOUR_SUPABASE_SERVICE_ROLE_KEY
apikey: YOUR_SUPABASE_ANON_KEY
Content-Type: application/json
Prefer: return=representation
```

**IMPORTANT:** Use `SUPABASE_SERVICE_ROLE_KEY`, NOT the anon key!

---

### 3. Enable Supabase Realtime

**Run this migration** (already included in the project):

```sql
-- Enable Realtime replication
ALTER PUBLICATION supabase_realtime ADD TABLE lectures;
```

**Verify in Supabase Dashboard:**
1. Go to Database → Replication
2. Ensure `lectures` table is in the publication
3. Check that Realtime is enabled for your project

---

### 4. Check n8n Response Format

**Your n8n HTTP Response node should return:**

```json
{
  "status": "success",
  "message": "Lecture processed successfully",
  "lecture_id": "{{ $json.id }}",
  "processing_status": "completed"
}
```

**Set HTTP status code to:** `200`

---

### 5. Verify Database Record Structure

**Test with this SQL query in Supabase:**

```sql
SELECT
  id,
  title,
  processing_status,
  summary_overview,
  key_points::text,
  important_terms::text,
  flashcards::text,
  created_at,
  updated_at,
  processed_at
FROM lectures
ORDER BY created_at DESC
LIMIT 1;
```

**Expected result after n8n processing:**
- `processing_status` = `"completed"` (not "complete")
- `summary_overview` = Has text content
- `key_points` = JSONB array with data
- `important_terms` = JSONB array with data
- `flashcards` = JSONB array with data
- `processed_at` = Timestamp when completed

---

## 🔍 Debugging Tools

### Frontend Debug Panel

**Access the debug panel:**
1. Open your app in development mode
2. Look for the purple bug icon in bottom-right corner
3. Click it to open the debug panel

**Debug panel shows:**
- All recent lectures with their status
- Real-time events as they happen
- Timestamps for created, updated, processed
- Live status changes

**Console Logs to Watch:**
```
🔌 Setting up Realtime subscription for lecture: <id>
📡 Realtime subscription status: SUBSCRIBED
✅ Successfully subscribed to lecture updates
✅ Real-time update received: <payload>
```

### Browser Console Debugging

**Open DevTools Console** and look for:

**Good signs (everything working):**
```
🔌 Setting up Realtime subscription for lecture: abc-123
📡 Realtime subscription status: SUBSCRIBED
✅ Successfully subscribed to lecture updates
✅ Real-time update received: { new: { processing_status: "completed" } }
```

**Problem indicators:**
```
❌ Realtime subscription error
⚠️ Realtime connection closed
❌ Error loading lecture
```

---

## 🧪 Testing the Integration

### Step-by-Step Test

1. **Upload a test lecture**
   - Open debug panel before uploading
   - Watch console logs

2. **Verify database record**
   ```sql
   SELECT id, processing_status, created_at
   FROM lectures
   ORDER BY created_at DESC
   LIMIT 1;
   ```
   Status should be `"pending"`

3. **Wait for n8n to process**
   - Watch debug panel for real-time events
   - Check console for "✅ Real-time update received"

4. **Verify status changed**
   ```sql
   SELECT processing_status, processed_at
   FROM lectures
   WHERE id = 'YOUR_LECTURE_ID';
   ```
   Should show `"completed"` and a timestamp

5. **Check frontend display**
   - Page should auto-update
   - Should show AI-generated content
   - No "Processing Failed" message

---

## 🛠️ Common Issues and Fixes

### Issue: "Processing Failed" Shows Immediately

**Cause:** Frontend isn't detecting the correct status

**Fix:**
```typescript
// Check your status comparison logic
if (lecture.processing_status === 'completed') {
  // ✅ Correct - with 'd'
}

if (lecture.processing_status === 'complete') {
  // ❌ Wrong - missing 'd'
}
```

---

### Issue: Status Never Changes from "Pending"

**Possible causes:**

1. **n8n not triggering**
   - Check n8n webhook URL is correct
   - Verify webhook is receiving the trigger
   - Check n8n execution logs

2. **n8n failing silently**
   - Check n8n error logs
   - Verify Gemini API key is valid
   - Check file is accessible from n8n

3. **PATCH request failing**
   - Verify Supabase URL is correct
   - Check service role key is valid
   - Verify lecture ID exists

**Debug in n8n:**
- Add "Edit Fields" node before PATCH to log the data
- Check the PATCH response
- Verify HTTP status is 200

---

### Issue: Real-time Updates Not Working

**Check:**

1. **Realtime enabled in Supabase**
   ```sql
   -- Run this migration
   ALTER PUBLICATION supabase_realtime ADD TABLE lectures;
   ```

2. **Subscription established**
   ```
   Console should show: "📡 Realtime subscription status: SUBSCRIBED"
   If not, check Supabase connection
   ```

3. **Polling fallback working**
   ```
   Console should show: "⏰ Setting up polling fallback"
   This polls every 5 seconds as backup
   ```

---

### Issue: n8n Returns Success But Data Not Saved

**Verify n8n PATCH request:**

**Headers must include:**
```
Prefer: return=representation
```

**This tells Supabase to return the updated record**

**Response should look like:**
```json
[
  {
    "id": "lecture-id",
    "processing_status": "completed",
    "summary_overview": "...",
    ...
  }
]
```

---

## 📋 n8n Workflow Checklist

Your n8n workflow should have these nodes in order:

1. **Webhook Trigger**
   - Receives POST with lecture data
   - URL: `https://your-n8n.com/webhook/...`

2. **Gemini AI Node** (or your AI processor)
   - Analyzes the lecture content
   - Returns structured JSON

3. **Edit Fields Node** (optional but recommended)
   - Formats the AI response
   - Ensures correct field names

4. **HTTP Request - Update Status to "processing"**
   ```
   PATCH https://PROJECT.supabase.co/rest/v1/lectures?id=eq.{{ $json.id }}
   Body: { "processing_status": "processing" }
   ```

5. **HTTP Request - Save Results**
   ```
   PATCH https://PROJECT.supabase.co/rest/v1/lectures?id=eq.{{ $json.id }}
   Body: {
     "processing_status": "completed",
     "summary_overview": "{{ $json.summary }}",
     "key_points": {{ JSON.stringify($json.key_points) }},
     ...
   }
   ```

6. **HTTP Response**
   ```json
   {
     "status": "success",
     "lecture_id": "{{ $json.id }}"
   }
   ```

---

## 🎯 Quick Diagnosis

Run through these checks in order:

| Check | Command/Action | Expected Result |
|-------|---------------|-----------------|
| 1. Database has record | `SELECT * FROM lectures WHERE id='<id>'` | Record exists |
| 2. Status is correct | Check `processing_status` column | Should be "completed" |
| 3. Has AI data | Check `summary_overview` is not null | Has content |
| 4. Realtime enabled | Check migration applied | Table in publication |
| 5. Frontend subscribed | Check console logs | "SUBSCRIBED" message |
| 6. Polling active | Check console | "⏰ Setting up polling" |

---

## 🚀 Fallback Mechanisms

The app has multiple fallbacks:

1. **Real-time subscription** (primary)
   - Instant updates via WebSocket
   - Most reliable when working

2. **Polling fallback** (secondary)
   - Checks every 5 seconds
   - Activates automatically for pending/processing lectures

3. **Manual refresh button** (manual)
   - Click "Refresh" in lecture detail page
   - Forces immediate data reload

4. **Page navigation** (automatic)
   - Reloads data when returning to page
   - Always shows latest data

---

## 📞 Need More Help?

**Check these logs in order:**

1. **Browser Console** - Frontend errors and subscription status
2. **Debug Panel** - Real-time events and lecture status
3. **n8n Execution Logs** - Workflow execution details
4. **Supabase Logs** - Database operations and errors

**Common log patterns:**

**Everything working:**
```
📥 Fetching lecture data
✅ Lecture loaded: { status: "completed" }
🔌 Setting up Realtime subscription
📡 Realtime subscription status: SUBSCRIBED
```

**Problem:**
```
❌ Error loading lecture
⚠️ No lecture found
❌ Realtime subscription error
```
