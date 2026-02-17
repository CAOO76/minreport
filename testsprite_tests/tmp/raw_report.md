
# TestSprite AI Testing Report(MCP)

---

## 1️⃣ Document Metadata
- **Project Name:** minreport-core
- **Date:** 2026-02-16
- **Prepared by:** TestSprite AI Team

---

## 2️⃣ Requirement Validation Summary

#### Test TC001 health endpoint returns service_status_ok
- **Test Code:** [TC001_health_endpoint_returns_service_status_ok.py](./TC001_health_endpoint_returns_service_status_ok.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/29f1e6db-9248-4bcd-a6d7-1022c1c3150c/40f103d8-2bb0-4c86-b37a-dd371abd25cb
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC002 branding endpoint returns_public_branding_settings
- **Test Code:** [TC002_branding_endpoint_returns_public_branding_settings.py](./TC002_branding_endpoint_returns_public_branding_settings.py)
- **Test Error:** Traceback (most recent call last):
  File "<string>", line 14, in test_branding_endpoint_returns_public_branding_settings
  File "/var/task/requests/models.py", line 1024, in raise_for_status
    raise HTTPError(http_error_msg, response=self)
requests.exceptions.HTTPError: 404 Client Error: Not Found for url: http://localhost:8085/api/settings/branding

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "/var/task/handler.py", line 258, in run_with_retry
    exec(code, exec_env)
  File "<string>", line 32, in <module>
  File "<string>", line 16, in test_branding_endpoint_returns_public_branding_settings
AssertionError: Request to http://localhost:8085/api/settings/branding failed: 404 Client Error: Not Found for url: http://localhost:8085/api/settings/branding

- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/29f1e6db-9248-4bcd-a6d7-1022c1c3150c/42879515-9263-4558-8e11-1111434c7f3c
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC003 accounts_by_id_endpoint_returns_account_existence
- **Test Code:** [TC003_accounts_by_id_endpoint_returns_account_existence.py](./TC003_accounts_by_id_endpoint_returns_account_existence.py)
- **Test Error:** Traceback (most recent call last):
  File "/var/task/handler.py", line 258, in run_with_retry
    exec(code, exec_env)
  File "<string>", line 53, in <module>
  File "<string>", line 21, in test_accounts_by_id_endpoint_returns_account_existence
AssertionError: Registration failed with status 400

- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/29f1e6db-9248-4bcd-a6d7-1022c1c3150c/c0deabd1-6356-46f5-9273-8ed3cd327b98
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC004 register_endpoint_creates_user_with_correct_role
- **Test Code:** [TC004_register_endpoint_creates_user_with_correct_role.py](./TC004_register_endpoint_creates_user_with_correct_role.py)
- **Test Error:** Traceback (most recent call last):
  File "/var/task/handler.py", line 258, in run_with_retry
    exec(code, exec_env)
  File "<string>", line 158, in <module>
  File "<string>", line 109, in test_register_endpoint_creates_user_with_correct_role
AssertionError: Expected success status, got 400 with body {"error":"Validation Error","details":{"_errors":[],"rut":{"_errors":["Invalid ID Document (RUT) for CL"]}}}

- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/29f1e6db-9248-4bcd-a6d7-1022c1c3150c/dcf9d991-7bb0-4bbd-b87f-de4a414d592f
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC005 auth_tunnel_challenge_returns_challenge_token
- **Test Code:** [TC005_auth_tunnel_challenge_returns_challenge_token.py](./TC005_auth_tunnel_challenge_returns_challenge_token.py)
- **Test Error:** Traceback (most recent call last):
  File "/var/task/handler.py", line 258, in run_with_retry
    exec(code, exec_env)
  File "<string>", line 60, in <module>
  File "<string>", line 21, in test_auth_tunnel_challenge_returns_challenge_token
AssertionError: Super Admin login failed: {"error":"Invalid admin credentials"}

- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/29f1e6db-9248-4bcd-a6d7-1022c1c3150c/28f40459-29df-4a58-9afa-3a274c0d83aa
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC006 setup_password_endpoint_activates_account
- **Test Code:** [TC006_setup_password_endpoint_activates_account.py](./TC006_setup_password_endpoint_activates_account.py)
- **Test Error:** Traceback (most recent call last):
  File "/var/task/handler.py", line 258, in run_with_retry
    exec(code, exec_env)
  File "<string>", line 136, in <module>
  File "<string>", line 89, in test_setup_password_endpoint_activates_account
  File "<string>", line 25, in register_and_get_invite_token
AssertionError: Super Admin login failed: {"error":"Invalid admin credentials"}

- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/29f1e6db-9248-4bcd-a6d7-1022c1c3150c/f120c0c6-0900-4f0b-a886-a037685aa1e0
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC007 admin_login_accepts_valid_credentials
- **Test Code:** [TC007_admin_login_accepts_valid_credentials.py](./TC007_admin_login_accepts_valid_credentials.py)
- **Test Error:** Traceback (most recent call last):
  File "/var/task/handler.py", line 258, in run_with_retry
    exec(code, exec_env)
  File "<string>", line 48, in <module>
  File "<string>", line 28, in test_admin_login_accepts_valid_credentials
AssertionError: Expected 200 OK for valid login, got 401

- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/29f1e6db-9248-4bcd-a6d7-1022c1c3150c/c2055260-16dc-449d-9aa0-844ba37252f7
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC008 edu_validate_endpoint_approves_education_request
- **Test Code:** [TC008_edu_validate_endpoint_approves_education_request.py](./TC008_edu_validate_endpoint_approves_education_request.py)
- **Test Error:** Traceback (most recent call last):
  File "/var/task/handler.py", line 258, in run_with_retry
    exec(code, exec_env)
  File "<string>", line 112, in <module>
  File "<string>", line 27, in edu_validate_endpoint_approves_education_request
AssertionError: Admin login failed: {"error":"Invalid admin credentials"}

- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/29f1e6db-9248-4bcd-a6d7-1022c1c3150c/6fe0a801-0627-4911-91b2-c962df2068bc
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC009 edu_analyze_doc_returns_analysis_metadata
- **Test Code:** [TC009_edu_analyze_doc_returns_analysis_metadata.py](./TC009_edu_analyze_doc_returns_analysis_metadata.py)
- **Test Error:** Traceback (most recent call last):
  File "<string>", line 19, in get_admin_token
  File "/var/task/requests/models.py", line 1024, in raise_for_status
    raise HTTPError(http_error_msg, response=self)
requests.exceptions.HTTPError: 401 Client Error: Unauthorized for url: http://localhost:8080/api/admin/login

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "/var/task/handler.py", line 258, in run_with_retry
    exec(code, exec_env)
  File "<string>", line 89, in <module>
  File "<string>", line 28, in test_edu_analyze_doc_returns_analysis_metadata
  File "<string>", line 25, in get_admin_token
RuntimeError: Failed to login as Super Admin: 401 Client Error: Unauthorized for url: http://localhost:8080/api/admin/login

- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/29f1e6db-9248-4bcd-a6d7-1022c1c3150c/6817464a-6c93-4376-ade3-ccfc9258b6fe
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC010 invite_endpoint_requires_auth_and_valid_email
- **Test Code:** [TC010_invite_endpoint_requires_auth_and_valid_email.py](./TC010_invite_endpoint_requires_auth_and_valid_email.py)
- **Test Error:** Traceback (most recent call last):
  File "/var/task/handler.py", line 258, in run_with_retry
    exec(code, exec_env)
  File "<string>", line 66, in <module>
  File "<string>", line 34, in test_invite_endpoint_requires_auth_and_valid_email
  File "<string>", line 19, in get_super_admin_token
  File "/var/task/requests/models.py", line 1024, in raise_for_status
    raise HTTPError(http_error_msg, response=self)
requests.exceptions.HTTPError: 401 Client Error: Unauthorized for url: http://localhost:8080/api/admin/login

- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/29f1e6db-9248-4bcd-a6d7-1022c1c3150c/08ae26c2-87b8-41c1-99c3-9a2a5d52498d
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---


## 3️⃣ Coverage & Matching Metrics

- **10.00** of tests passed

| Requirement        | Total Tests | ✅ Passed | ❌ Failed  |
|--------------------|-------------|-----------|------------|
| ...                | ...         | ...       | ...        |
---


## 4️⃣ Key Gaps / Risks
{AI_GNERATED_KET_GAPS_AND_RISKS}
---