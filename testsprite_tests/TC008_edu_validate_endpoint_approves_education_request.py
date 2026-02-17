import requests
import traceback

BASE_URL = "http://localhost:8080"
TIMEOUT = 30

# Admin credentials seeded in the emulator/global setup
ADMIN_EMAIL = "superadmin@admin.edu"
ADMIN_PASSWORD = "SuperSecretPassword123!"

# Educational user registration details
EDU_USER_EMAIL = "student@university.edu"
EDU_USER_PASSWORD = "EduUserPass123!"
EDU_USER_RUN = "12345678-9"  # example RUN, adjust if needed

def edu_validate_endpoint_approves_education_request():
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})

    try:
        # 1. Admin login to get auth token
        login_resp = session.post(
            f"{BASE_URL}/api/admin/login",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            timeout=TIMEOUT,
        )
        assert login_resp.status_code == 200, f"Admin login failed: {login_resp.text}"
        token = login_resp.json().get("token")
        assert token, "No token received on admin login"
        session.headers.update({"Authorization": f"Bearer {token}"})

        # 2. Register an educational user with PENDING_VALIDATION role
        register_payload = {
            "email": EDU_USER_EMAIL,
            "password": EDU_USER_PASSWORD,
            "run": EDU_USER_RUN,
        }
        register_resp = requests.post(
            f"{BASE_URL}/api/auth/register",
            json=register_payload,
            timeout=TIMEOUT,
        )
        assert register_resp.status_code == 201, f"Registration failed: {register_resp.text}"

        # 3. Upload an educational document for analysis as authenticated admin to get requestId
        # We must authenticate for /api/edu/analyze-doc, so reuse admin token
        doc_payload = {
            "email": EDU_USER_EMAIL,
            "document": "base64EncodedDummyDocumentString",
            "documentType": "student_id_card",
        }
        analyze_resp = session.post(
            f"{BASE_URL}/api/edu/analyze-doc",
            json=doc_payload,
            timeout=TIMEOUT,
        )
        assert analyze_resp.status_code == 200, f"Analyze doc failed: {analyze_resp.text}"
        analyze_data = analyze_resp.json()
        requestId = analyze_data.get("requestId")
        assert requestId, "No requestId returned from document analysis"

        # 4. Approve education request via POST /api/edu/validate/:requestId as authenticated admin
        validate_resp = session.post(
            f"{BASE_URL}/api/edu/validate/{requestId}",
            timeout=TIMEOUT,
        )
        assert validate_resp.status_code == 200, f"Validate endpoint failed: {validate_resp.text}"
        validate_data = validate_resp.json()
        assert validate_data.get("status") == "approved", f"Unexpected validation status: {validate_data}"

        # 5. Login as the educational user and check the role change to EDUCATIONAL
        user_login_resp = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": EDU_USER_EMAIL, "password": EDU_USER_PASSWORD},
            timeout=TIMEOUT,
        )
        assert user_login_resp.status_code == 200, f"User login failed: {user_login_resp.text}"
        user_data = user_login_resp.json()
        assert user_data.get("role") == "EDUCATIONAL", f"User role not updated: {user_data}"
        
    except AssertionError as ae:
        print("Assertion failed:", ae)
        traceback.print_exc()
        raise
    except Exception:
        print("Unexpected error:")
        traceback.print_exc()
        raise
    finally:
        # Cleanup: Delete the educational user and any cleanup needed (if API supports)
        try:
            # Admin login token already available
            if "Authorization" not in session.headers:
                login_resp = session.post(
                    f"{BASE_URL}/api/admin/login",
                    json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                    timeout=TIMEOUT,
                )
                token = login_resp.json().get("token")
                session.headers.update({"Authorization": f"Bearer {token}"})

            # Attempt to delete the user by email (assuming such an endpoint exists)
            # No delete user endpoint defined in PRD, so attempt public accounts-by-id taxId delete is unsupported
            # Could add soft cleanup or skip if not supported by API
            pass
        except Exception:
            # Log but ignore cleanup errors
            print("Cleanup failed:")
            traceback.print_exc()


edu_validate_endpoint_approves_education_request()