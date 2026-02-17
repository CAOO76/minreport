import requests
import re

BASE_URL = "http://localhost:8080"
TIMEOUT = 30

def get_super_admin_token():
    """
    Logs in as seeded Super Admin via emulator and returns the auth token.
    """
    login_url = f"{BASE_URL}/api/admin/login"
    # Assuming seeded Super Admin credentials (as no explicit credentials given)
    # These should match the seeded Super Admin in the emulator
    credentials = {
        "email": "superadmin@example.com",
        "password": "SuperAdminPassword123!"
    }
    response = requests.post(login_url, json=credentials, timeout=TIMEOUT)
    response.raise_for_status()
    data = response.json()
    token = data.get("token") or data.get("accessToken")  # depending on API token property
    assert token, "Super Admin login did not return a token"
    return token

def test_invite_endpoint_requires_auth_and_valid_email():
    invite_url = f"{BASE_URL}/api/auth/invite"

    # 1. Attempt to POST /api/auth/invite without auth - should reject
    invalid_payload = {"email": "validuser@example.com", "company": {"name": "TestCo"}}
    r_unauth = requests.post(invite_url, json=invalid_payload, timeout=TIMEOUT)
    assert r_unauth.status_code in (401, 403), f"Expected 401 or 403 for unauthenticated invite, got {r_unauth.status_code}"

    # Get auth token for Super Admin
    token = get_super_admin_token()
    headers = {"Authorization": f"Bearer {token}"}

    # 2. POST /api/auth/invite with malformed email - expect 400 validation error
    malformed_emails = ["plainaddress", "missingatsign.com", "missingdomain@.com", "missingusername@com", "user@com.", "@no-local-part.com"]
    for bad_email in malformed_emails:
        payload = {"email": bad_email, "company": {"name": "TestCo"}}
        r = requests.post(invite_url, json=payload, headers=headers, timeout=TIMEOUT)
        assert r.status_code == 400, f"Malformed email '{bad_email}' did not return 400, got {r.status_code}"
        resp_json = r.json()
        # Assume API returns error info about invalid email
        error_msg = resp_json.get("error") or resp_json.get("message") or ""
        assert re.search(r"email", error_msg, re.IGNORECASE), f"Error message does not mention email for '{bad_email}': {error_msg}"

    # 3. POST /api/auth/invite with a valid email - expect success (201 or 200)
    valid_email = "invitee@example.com"
    payload_valid = {"email": valid_email, "company": {"name": "TestCo"}}

    # First invite attempt - create invite
    r_valid = requests.post(invite_url, json=payload_valid, headers=headers, timeout=TIMEOUT)
    assert r_valid.status_code in (200, 201), f"Valid invite request failed with status {r_valid.status_code}"
    resp_data = r_valid.json()
    invite_token = resp_data.get("inviteToken") or resp_data.get("token") or resp_data.get("id")
    assert invite_token, "Invite response missing invite token/id"

    # 4. POST /api/auth/invite with the same email again - expect conflict 409
    r_conflict = requests.post(invite_url, json=payload_valid, headers=headers, timeout=TIMEOUT)
    assert r_conflict.status_code == 409, f"Duplicate invite did not return 409, got {r_conflict.status_code}"
    conflict_resp = r_conflict.json()
    conflict_msg = conflict_resp.get("error") or conflict_resp.get("message") or ""
    assert "duplicate" in conflict_msg.lower() or "conflict" in conflict_msg.lower(), "Conflict error message missing or unexpected"

test_invite_endpoint_requires_auth_and_valid_email()