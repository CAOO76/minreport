import requests
import uuid

BASE_URL = "http://localhost:8080"
TIMEOUT = 30

# Update superadmin credentials with correct seeded values
SUPERADMIN_EMAIL = "superadmin@company.com"  # Replace with actual Super Admin email
SUPERADMIN_PASSWORD = "SuperAdminPassword123!"  # Replace with actual Super Admin password

def test_setup_password_endpoint_activates_account():
    # Helper function to register and get invite token for a user
    def register_and_get_invite_token():
        # Use a unique email to avoid conflicts
        unique_email = f"owner-{uuid.uuid4()}@example.com"
        headers = {"Content-Type": "application/json"}

        # 1. Login as Super Admin to get auth token
        login_resp = requests.post(
            f"{BASE_URL}/api/admin/login",
            json={"email": SUPERADMIN_EMAIL, "password": SUPERADMIN_PASSWORD},
            headers=headers,
            timeout=TIMEOUT,
        )
        assert login_resp.status_code == 200, f"Super Admin login failed: {login_resp.text}"
        superadmin_token = login_resp.json().get("token")
        assert superadmin_token, "No token received for Super Admin"

        auth_headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {superadmin_token}",
        }

        # 2. Invite Owner user
        invite_payload = {
            "email": unique_email,
            "companyMetadata": {"companyName": "TestCompany for Setup Password"},
        }
        invite_resp = requests.post(
            f"{BASE_URL}/api/auth/invite",
            json=invite_payload,
            headers=auth_headers,
            timeout=TIMEOUT,
        )
        assert invite_resp.status_code == 201, f"Invite failed: {invite_resp.text}"

        # 3. Retrieve invite token from invite response (usually token is returned)
        invite_json = invite_resp.json()
        invite_token = invite_json.get("inviteToken") or invite_json.get("token")
        assert invite_token, "No invite token returned in invite response"

        # 4. Obtain challenge token
        challenge_resp = requests.post(
            f"{BASE_URL}/api/auth/tunnel/challenge",
            json={"token": invite_token},
            headers={"Content-Type": "application/json"},
            timeout=TIMEOUT,
        )
        assert challenge_resp.status_code == 200, f"Challenge endpoint failed with valid invite token: {challenge_resp.text}"

        challenge_token = challenge_resp.json().get("challengeToken")
        assert challenge_token, "No challenge token returned"

        return unique_email, challenge_token

    # 5. Use /api/auth/tunnel/setup-password with valid challenge token to activate account and set password
    def setup_password(token, password):
        payload = {"token": token, "password": password}
        resp = requests.post(
            f"{BASE_URL}/api/auth/tunnel/setup-password",
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=TIMEOUT,
        )
        return resp

    # 6. Try to login with the new credentials
    def login_with_setup_password(email, password):
        payload = {"email": email, "password": password}
        resp = requests.post(
            f"{BASE_URL}/api/admin/login",
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=TIMEOUT,
        )
        return resp

    # Generate user and obtain token
    email, challenge_token = register_and_get_invite_token()
    user_password = "NewStrongPassw0rd!"

    try:
        # VALID TOKEN AND PASSWORD SETUP (SUCCESS CASE)
        setup_resp = setup_password(challenge_token, user_password)
        assert setup_resp.status_code == 200, f"Setup password failed: {setup_resp.text}"
        setup_json = setup_resp.json()
        assert (
            "message" in setup_json or "success" in setup_json
        ), "Expected success message in response"

        # Successful login with new credentials
        login_resp = login_with_setup_password(email, user_password)
        assert login_resp.status_code == 200, f"Login with new credentials failed: {login_resp.text}"
        assert "token" in login_resp.json(), "No token returned on successful login"

        # INVALID TOKEN (random string)
        invalid_token = "invalidtoken123"
        invalid_setup_resp = setup_password(invalid_token, "AnyPassword1!")
        assert invalid_setup_resp.status_code in (
            400,
            401,
        ), f"Invalid token setup password should fail with 400 or 401, got {invalid_setup_resp.status_code}"
        invalid_json = invalid_setup_resp.json()
        assert (
            "error" in invalid_json or "message" in invalid_json
        ), "Expected error message for invalid token"

        # EXPIRED TOKEN SIMULATION
        # Re-use challenge_token again should be invalid if token is single-use

        expired_setup_resp = setup_password(challenge_token, "AnotherPass1!")
        assert expired_setup_resp.status_code in (
            400,
            401,
        ), f"Expired token reuse should fail with 400 or 401, got {expired_setup_resp.status_code}"
        expired_json = expired_setup_resp.json()
        assert (
            "error" in expired_json or "message" in expired_json
        ), "Expected error message for expired token"

    except AssertionError:
        raise
    except Exception as e:
        raise AssertionError(f"Unexpected exception occurred: {e}")

test_setup_password_endpoint_activates_account()
