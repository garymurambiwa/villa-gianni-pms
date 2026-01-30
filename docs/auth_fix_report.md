# Authentication System Fix Report

## 1. Issue Analysis
The "Not logged in" error during password reset was caused by a **session persistence failure** specific to the database authentication provider ("DB" mode).

### Root Cause
1.  **Missing Session Persistence:** When a user logged in via the central database (`pmsAuthDb`), the application updated the in-memory React state but failed to write a session token to `localStorage`.
2.  **Session Loss on Navigation:** When the application redirected the user to the `/password-change` route (required for first-time logins), the `AuthContext` re-initialized or checked for session expiry.
3.  **Expiry Logic:** The `checkSessionExpiry` routine found no valid session in `localStorage`, presumed the user was unauthenticated, and triggered a `logout()`, clearing the in-memory user state.
4.  **Action Failure:** Consequently, when the `changePassword` function was called, the `user` object was null, triggering the "Not logged in" guard clause.

## 2. Implemented Solution

### 2.1. Session Persistence for DB Users
Modified `src/context/AuthContext.tsx` to explicitly create and persist a session record in `localStorage` upon successful database login.
```typescript
auth.createSession({
  id: resDb.user.id,
  username: resDb.user.username,
  // ... mapped fields
});
```

### 2.2. Session Restoration Logic
Updated the initialization effect in `AuthContext.tsx` to handle "hybrid" sessions where the session token exists but the user data resides in the remote database (not the local browser store).
- Added logic to check `pmsAuthDb.getUser(id)` if a session exists but the user is not found locally.
- Added `getUser(id)` method to `src/lib/pmsAuthDb.ts` to support this lookup.

### 2.3. User Experience Flow
1.  **Login:** User logs in → Session saved → State updated.
2.  **Redirect:** App redirects to `/password-change`.
3.  **Persistence:** Session is valid → User state is restored/maintained.
4.  **Update:** Password update request succeeds.
5.  **Completion:** `passwordChangeRequired` flag is cleared locally → User redirected to Dashboard.

## 3. Verification
- **First-time Login:** Verified that the session survives the redirect, allowing the password change to complete successfully.
- **Session Security:** The fix leverages the existing `authService` session management, maintaining consistency with the local-auth behavior.
- **Code Safety:** Changes are typed and include error handling for database connection failures during restoration.

The authentication flow is now robust and supports the forced password change lifecycle without state loss.
