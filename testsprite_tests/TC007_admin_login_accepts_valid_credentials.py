import requests

BASE_URL = "http://localhost:8080"
ADMIN_LOGIN_ENDPOINT = "/api/admin/login"
TIMEOUT = 30

def test_admin_login_accepts_valid_credentials():
    valid_credentials = {
        "email": "owner@example.com",
        "password": "CorrectPassword123!"
    }
    invalid_credentials = {
        "email": "owner@example.com",
        "password": "WrongPassword!"
    }
    headers = {
        "Content-Type": "application/json"
    }

    # Test valid credentials login
    try:
        response_valid = requests.post(
            BASE_URL + ADMIN_LOGIN_ENDPOINT,
            json=valid_credentials,
            headers=headers,
            timeout=TIMEOUT
        )
        assert response_valid.status_code == 200, f"Expected 200 OK for valid login, got {response_valid.status_code}"
        json_resp = response_valid.json()
        assert "token" in json_resp and isinstance(json_resp["token"], str) and len(json_resp["token"]) > 0, "Token missing or empty in valid login response"
    except requests.RequestException as e:
        assert False, f"Request failed during valid credentials test: {e}"

    # Test invalid credentials login
    try:
        response_invalid = requests.post(
            BASE_URL + ADMIN_LOGIN_ENDPOINT,
            json=invalid_credentials,
            headers=headers,
            timeout=TIMEOUT
        )
        assert response_invalid.status_code in (401, 403), f"Expected 401 or 403 for invalid login, got {response_invalid.status_code}"
        json_resp_invalid = response_invalid.json()
        assert "error" in json_resp_invalid or "message" in json_resp_invalid, "Error message expected in invalid login response"
    except requests.RequestException as e:
        assert False, f"Request failed during invalid credentials test: {e}"

test_admin_login_accepts_valid_credentials()