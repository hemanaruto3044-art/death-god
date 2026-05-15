# Security Specification - DEATH GOD

## Data Invariants
1. A user profile (`/users/{userId}`) must be owned by the authenticated user.
2. A UID mapping (`/uids/{displayUid}`) must point to the authenticated user who "owned" that UID.
3. `displayUid` must strictly be a 5-digit numeric string (e.g., '12345').
4. Timestamps must be server-generated.

## The Dirty Dozen Payloads (Rejection Tests)
1. **Identity Theft**: User A tries to write to `/users/UserB`.
2. **UID Hijacking**: User A tries to claim a `displayUid` that already exists and points to User B.
3. **Invalid ID Format**: User tries to set `displayUid` to "ABCDE" (not numeric) or "123456" (too long).
4. **Token Poisoning**: User tries to set a 2MB string as an `fcmToken`.
5. **Timestamp Spoofing**: User tries to set a hardcoded `updatedAt` in the past.
6. **Field Injection**: User tries to add `isAdmin: true` to their profile.
7. **Orphaned Mapping**: User creates a UID mapping but doesn't have a corresponding user profile (though here mapping *is* the lookup).
8. **Malicious Lookup**: User tries to list all UID mappings (scraping).
9. **Display Name Length**: User sets a 10,000 character display name.
10. **Numeric ID Injection**: User tries to inject a script tag into `displayName`.
11. **Path Poisoning**: User tries to use `../` in a document ID.
12. **Anonymous Access**: User tries to write without being a "Guest" (authenticated).

## Test Runner (Logic)
The `firestore.rules` will enforce these via `isValidUser` and `isValidUid` helpers.
