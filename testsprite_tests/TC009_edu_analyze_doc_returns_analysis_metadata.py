import requests
import json

BASE_URL = "http://localhost:8080"
TIMEOUT = 30

# Super Admin credentials for authentication (assuming these are seeded in emulator)
SUPER_ADMIN_EMAIL = "superadmin@local.test"
SUPER_ADMIN_PASSWORD = "SuperAdminPassword1!"

def get_admin_token():
    login_url = f"{BASE_URL}/api/admin/login"
    payload = {
        "email": SUPER_ADMIN_EMAIL,
        "password": SUPER_ADMIN_PASSWORD
    }
    try:
        resp = requests.post(login_url, json=payload, timeout=TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        token = data.get("token")
        assert token, "No token returned from admin login"
        return token
    except Exception as e:
        raise RuntimeError(f"Failed to login as Super Admin: {e}")

def test_edu_analyze_doc_returns_analysis_metadata():
    token = get_admin_token()
    headers = {
        "Authorization": f"Bearer {token}"
    }
    analyze_url = f"{BASE_URL}/api/edu/analyze-doc"

    # Valid document payload (simulate a small PDF base64 or JSON with doc details)
    valid_document_payload = {
        "document": {
            "filename": "valid_doc.pdf",
            "contentType": "application/pdf",
            "contentBase64": "JVBERi0xLjQKJcTl8uXrp/Og0MTGCjQgMCBvYmogICUgZW50cnkgcG9pbnQKPDwKL0xlbmd0aCAxIDAgUgo+Pg=="  # truncated base64 pdf dummy
        }
    }

    # Corrupted document payload (invalid base64 content)
    corrupted_document_payload = {
        "document": {
            "filename": "corrupted_doc.pdf",
            "contentType": "application/pdf",
            "contentBase64": "!!!!invalid-base64****"
        }
    }

    # Unsupported document payload (unsupported content type)
    unsupported_document_payload = {
        "document": {
            "filename": "file.exe",
            "contentType": "application/x-msdownload",
            "contentBase64": "TVqQAAMAAAAEAAAA//8AALgAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        }
    }

    # Helper to post doc analysis and return response
    def post_analyze_doc(payload):
        try:
            response = requests.post(analyze_url, headers=headers, json=payload, timeout=TIMEOUT)
            return response
        except Exception as e:
            raise RuntimeError(f"Request to /api/edu/analyze-doc failed: {e}")

    # Test valid document
    resp_valid = post_analyze_doc(valid_document_payload)
    assert resp_valid.status_code == 200, f"Valid document analysis failed with status {resp_valid.status_code}"
    json_valid = resp_valid.json()
    assert "analysis" in json_valid, "Response missing 'analysis' key for valid doc"
    assert isinstance(json_valid.get("analysis"), dict), "'analysis' should be a dict"
    assert "requestId" in json_valid and isinstance(json_valid["requestId"], str) and len(json_valid["requestId"]) > 0, "Missing or invalid 'requestId' in response for valid doc"

    # Test corrupted document
    resp_corrupted = post_analyze_doc(corrupted_document_payload)
    assert resp_corrupted.status_code in (400, 422), f"Corrupted document should return 400 or 422 but got {resp_corrupted.status_code}"
    json_corrupted = resp_corrupted.json()
    assert "error" in json_corrupted or "message" in json_corrupted, "Corrupted doc response missing error message"

    # Test unsupported document
    resp_unsupported = post_analyze_doc(unsupported_document_payload)
    assert resp_unsupported.status_code in (400, 415), f"Unsupported document should return 400 or 415 but got {resp_unsupported.status_code}"
    json_unsupported = resp_unsupported.json()
    assert "error" in json_unsupported or "message" in json_unsupported, "Unsupported doc response missing error message"

test_edu_analyze_doc_returns_analysis_metadata()