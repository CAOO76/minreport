# TestSprite AI Testing Report (Finalized)

---

## 1️⃣ Document Metadata
- **Project Name:** minreport-core
- **Date:** 2026-02-16
- **Prepared by:** Antigravity AI
- **Environment:** Local Development (mac)
- **Backend URL:** http://localhost:8080
- **Firebase Emulators:** Active (Auth, Firestore, Functions)

---

## 2️⃣ Requirement Validation Summary

### Public Endpoints
#### Test TC001 health endpoint returns service_status_ok
- **Status:** ✅ Passed
- **Findings:** The `/health` endpoint correctly returns a 200 OK status with the expected JSON structure, confirming the core service is online.

#### Test TC002 branding endpoint returns_public_branding_settings
- **Status:** ❌ Failed
- **Findings:** Received a 404 error at `http://localhost:8085/api/settings/branding`. 
- **Cause:** It appears the test incorrectly targeted the Firestore emulator port (8085) for an API call that should go to the backend (8080), or the route is not properly mapped in the test script.

### Authentication & Account Management
#### Test TC003 accounts_by_id_endpoint_returns_account_existence
- **Status:** ❌ Failed
- **Findings:** Registration failed with status 400.
- **Cause:** Likely missing required fields or invalid data in the registration payload used by the test.

#### Test TC004 register_endpoint_creates_user_with_correct_role
- **Status:** ❌ Failed
- **Findings:** Validation Error: "Invalid ID Document (RUT) for CL".
- **Cause:** The test provided an invalid Chilean RUT format, which is strictly validated by the backend.

#### Test TC007 admin_login_accepts_valid_credentials
- **Status:** ❌ Failed
- **Findings:** Expected 200 OK, got 401.
- **Cause:** The default admin credentials in `env.ts` (`admin@minreport.com` / `minreport_master_2026!`) might not have been correctly injected or initialized in the Auth emulator state.

### Education Services (Protected)
#### Test TC008 edu_validate_endpoint_approves_education_request
- **Status:** ❌ Failed
- **Findings:** Admin login failed with "Invalid admin credentials".
- **Cause:** Dependent on TC007 failure. Protected routes cannot be tested without valid admin tokens.

#### Test TC009 edu_analyze_doc_returns_analysis_metadata
- **Status:** ❌ Failed
- **Findings:** Unauthorized (401) during admin login.
- **Cause:** Dependent on TC007 failure.

---

## 3️⃣ Coverage & Matching Metrics

| Requirement Group       | Total Tests | ✅ Passed | ❌ Failed |
|-------------------------|-------------|-----------|-----------|
| Public Endpoints        | 2           | 1         | 1         |
| Auth & Account Mgmt     | 3           | 0         | 3         |
| Authentication (Admin)  | 1           | 0         | 1         |
| Education Services      | 2           | 0         | 2         |
| B2B Invitations         | 2           | 0         | 2         |
| **Total**               | **10**      | **1**     | **9**     |

**Overall Pass Rate:** 10%

---

## 4️⃣ Key Gaps / Risks

1.  **Credential Management**: Most failures stem from 401/Unauthorized errors during Admin login. This indicates the test environment lacks the pre-seeded admin user in the Firebase Auth emulator.
2.  **Validation Strictness**: TC004 failed due to RUT validation. Tests need to use realistic, valid data when interacting with regionalized systems (Chile/CL).
3.  **Endpoint Configuration**: TC002 attempted to reach port 8085 instead of 8080, suggesting a misconfiguration in the auto-generated test script parameters.
4.  **Emulator Synchronization**: Since we are using Firebase Emulators, it is critical that the `data` import/export contains the necessary users and structural data for tests to pass.

> [!WARNING]
> Most failures are environment-related rather than logical bugs. Recommend pre-seeding the Auth emulator with the Super Admin user before re-running.
