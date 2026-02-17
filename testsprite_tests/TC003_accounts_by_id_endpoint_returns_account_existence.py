import requests

BASE_URL = "http://localhost:8080"
TIMEOUT = 30

def test_accounts_by_id_endpoint_returns_account_existence():
    # Create a new account to have a known existent run
    register_url = f"{BASE_URL}/api/auth/register"
    register_payload = {
        "email": "testuser_tc003@example.com",
        "password": "StrongPass!23",
        "run": "12345678-9",  # Valid RUN format with verifying digit
        "name": "Test User TC003"
    }
    headers = {"Content-Type": "application/json"}
    created_run = register_payload["run"]

    try:
        # Register new account (no auth required per PRD)
        resp_register = requests.post(register_url, json=register_payload, headers=headers, timeout=TIMEOUT)
        assert resp_register.status_code in [200, 201], f"Registration failed with status {resp_register.status_code}"

        # Test with existing run (using taxId as run in URL)
        url_exist = f"{BASE_URL}/api/public/accounts-by-id/{created_run}"
        resp_exist = requests.get(url_exist, timeout=TIMEOUT)
        assert resp_exist.status_code == 200, f"Expected 200 OK for existing taxId, got {resp_exist.status_code}"
        
        # According to description, should return true if account exists
        json_exist = resp_exist.json()
        assert "exists" in json_exist, "'exists' field missing in response for existing taxId"
        assert json_exist["exists"] is True, "Expected 'exists' to be True for existing taxId"

        # Test with non-existing taxId
        non_existing_taxId = "999999999999"
        url_non_exist = f"{BASE_URL}/api/public/accounts-by-id/{non_existing_taxId}"
        resp_non_exist = requests.get(url_non_exist, timeout=TIMEOUT)
        # Response might be 404 or 200 with exists=False as per description
        assert resp_non_exist.status_code in [200, 404], f"Expected 200 or 404 for non-existing taxId, got {resp_non_exist.status_code}"
        
        if resp_non_exist.status_code == 200:
            json_non_exist = resp_non_exist.json()
            assert "exists" in json_non_exist, "'exists' field missing in response for non-existing taxId"
            assert not json_non_exist["exists"], "Expected 'exists' to be False for non-existing taxId"
        else:
            # 404 response - typically body may be empty or contain error info
            pass

    finally:
        # Clean up: no deletion endpoint available
        pass


test_accounts_by_id_endpoint_returns_account_existence()
