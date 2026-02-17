import requests

BASE_URL = "http://localhost:8080"
TIMEOUT = 30

def test_auth_tunnel_challenge_returns_challenge_token():
    # Step 1: Create a valid invite via POST /api/auth/invite (requires Super Admin auth)
    # Update super admin credentials to correct ones matching seeded data
    super_admin_email = "superadmin@localhost"
    super_admin_password = "SuperAdminPass123!"
    invitee_email = "invitee@example.com"
    company_metadata = {"companyName": "Test Company", "industry": "Testing"}

    try:
        # Login as Super Admin to get auth token for invite
        login_resp = requests.post(
            f"{BASE_URL}/api/admin/login",
            json={"email": super_admin_email, "password": super_admin_password},
            timeout=TIMEOUT,
        )
        assert login_resp.status_code == 200, f"Super Admin login failed: {login_resp.text}"
        auth_token = login_resp.json().get("token")
        assert auth_token, "No auth token received from Super Admin login"

        headers_auth = {
            "Authorization": f"Bearer {auth_token}",
            "Content-Type": "application/json"
        }

        # Send invite
        invite_payload = {
            "email": invitee_email,
            "companyMetadata": company_metadata
        }
        invite_resp = requests.post(
            f"{BASE_URL}/api/auth/invite", json=invite_payload, headers=headers_auth, timeout=TIMEOUT
        )
        assert invite_resp.status_code == 201, f"Invite creation failed: {invite_resp.text}"
        invite_token = invite_resp.json().get("inviteToken")
        assert invite_token, "No invite token received from invite creation"

        # Step 2: POST /api/auth/tunnel/challenge with the valid invite token
        challenge_payload = {"inviteToken": invite_token}
        challenge_resp = requests.post(
            f"{BASE_URL}/api/auth/tunnel/challenge",
            json=challenge_payload,
            headers={"Content-Type": "application/json"},
            timeout=TIMEOUT,
        )
        # Validate response success and presence of challenge token
        assert challenge_resp.status_code == 200, f"Challenge request failed: {challenge_resp.text}"
        challenge_token = challenge_resp.json().get("challengeToken")
        assert challenge_token and isinstance(challenge_token, str) and len(challenge_token) > 0, "Invalid or missing challenge token"

    finally:
        # Cleanup: Delete the invite if API existed or cleanup logic was exposed
        # Since no delete endpoint for invite specified in PRD, skipping explicit cleanup
        pass

test_auth_tunnel_challenge_returns_challenge_token()
