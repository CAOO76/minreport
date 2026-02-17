import requests
import re

BASE_URL = "http://localhost:8080"
REGISTER_ENDPOINT = f"{BASE_URL}/api/auth/register"
TIMEOUT = 30

def test_register_endpoint_creates_user_with_correct_role():
    headers = {"Content-Type": "application/json"}
    test_cases = [
        # Valid B2B user - assuming company domain for B2B
        {
            "payload": {
                "email": "admin@companyb2b.com",
                "identifier": "123456789",
                "password": "StrongPass123!",
                "name": "B2B Admin",
                "country": "CL",
                "type": "ENTERPRISE",
                "applicant_name": "B2B Admin",
                "company_name": "Company B2B",
                "industry": "Software",
                "rut": "123456789"
            },
            "expected_role": "B2B",
            "expect_success": True
        },
        # Valid Educational user
        {
            "payload": {
                "email": "student@university.edu",
                "identifier": "987654321",
                "password": "EduPass123!",
                "name": "Edu Student",
                "country": "CL",
                "type": "EDUCATIONAL"
            },
            "expected_role": "EDUCATIONAL",
            "expect_success": True
        },
        # Valid Personal user
        {
            "payload": {
                "email": "user@gmail.com",
                "identifier": "234567890",
                "password": "PersonalPass123!",
                "name": "Personal User",
                "country": "CL",
                "type": "PERSONAL"
            },
            "expected_role": "PERSONAL",
            "expect_success": True
        },
        # Malformed email - invalid email format
        {
            "payload": {
                "email": "bad-email-format",
                "identifier": "345678901",
                "password": "BadEmailPass123!",
                "name": "Bad Email",
                "country": "CL",
                "type": "PERSONAL"
            },
            "expect_success": False,
            "expected_status_code": 400,
            "expected_error_field": "email"
        },
        # Malformed identifier - invalid RUN/RUT format (assuming format numerical string)
        {
            "payload": {
                "email": "validuser@gmail.com",
                "identifier": "abc123!@#",
                "password": "BadIdPass123!",
                "name": "Bad Identifier",
                "country": "CL",
                "type": "PERSONAL"
            },
            "expect_success": False,
            "expected_status_code": 400,
            "expected_error_field": "identifier"
        },
        # Missing password (validation error)
        {
            "payload": {
                "email": "nopassword@companyb2b.com",
                "identifier": "456789012",
                "name": "No Password",
                "country": "CL",
                "type": "ENTERPRISE",
                "applicant_name": "No Password",
                "company_name": "No Password Co",
                "industry": "Services",
                "rut": "456789012"
            },
            "expect_success": False,
            "expected_status_code": 400,
            "expected_error_field": "password"
        }
    ]

    for case in test_cases:
        payload = case["payload"]
        try:
            response = requests.post(REGISTER_ENDPOINT, json=payload, headers=headers, timeout=TIMEOUT)
        except requests.RequestException as e:
            assert False, f"Request failed: {e}"

        if case.get("expect_success"):
            assert response.status_code == 201 or response.status_code == 200, f"Expected success status, got {response.status_code} with body {response.text}"
            # On success, the response should include user's role field
            try:
                resp_json = response.json()
            except ValueError:
                assert False, "Response is not a valid JSON"

            role = resp_json.get("role") or resp_json.get("user", {}).get("role")
            assert role is not None, f"Role field missing in response: {resp_json}"
            expected_role = case["expected_role"]
            # Normalize role to uppercase for comparison if string
            if isinstance(role, str):
                role_up = role.upper()
            else:
                role_up = ""
            # Check for expected role naming variants (e.g. EDUCATIONAL vs Educational)
            assert (
                expected_role == role_up or expected_role == role
            ), f"Expected role '{expected_role}', got '{role}' in response: {resp_json}"

        else:
            # Expect validation error responses for malformed inputs
            expected_status = case.get("expected_status_code", 400)
            assert response.status_code == expected_status, f"Expected status {expected_status} but got {response.status_code} with body {response.text}"
            try:
                error_json = response.json()
            except ValueError:
                assert False, "Error response is not valid JSON"

            expected_field = case.get("expected_error_field")
            # Look for error indications in the response body for the field
            error_found = False
            if isinstance(error_json, dict):
                # Possible error structure: {errors: {field: [...]}} or {field: [..]} or {message: "error about field"}
                if "errors" in error_json and expected_field in error_json["errors"]:
                    error_found = True
                else:
                    # Check keys for expected field mention
                    for key, val in error_json.items():
                        if key == expected_field:
                            error_found = True
                            break
                    if not error_found:
                        # Check message or detail keys
                        msg = error_json.get("message", "") or error_json.get("detail", "")
                        if isinstance(msg, str) and expected_field in msg.lower():
                            error_found = True
            assert error_found, f"Expected validation error for field '{expected_field}' not found in response: {error_json}"

test_register_endpoint_creates_user_with_correct_role()
