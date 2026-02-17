import requests

BASE_URL = "http://localhost:8085"
TIMEOUT = 30

def test_branding_endpoint_returns_public_branding_settings():
    url = f"{BASE_URL}/api/settings/branding"
    headers = {
        "Accept": "application/json"
    }

    try:
        response = requests.get(url, headers=headers, timeout=TIMEOUT)
        response.raise_for_status()
    except requests.RequestException as e:
        assert False, f"Request to {url} failed: {e}"

    assert response.status_code == 200, f"Expected status code 200 but got {response.status_code}"

    try:
        data = response.json()
    except ValueError:
        assert False, "Response is not valid JSON"

    # Basic assertions on expected properties in public branding settings payload
    expected_keys = ["appName", "logoUrl", "themeColor", "organizationName"]
    assert isinstance(data, dict), "Branding settings response should be a JSON object"
    for key in expected_keys:
        assert key in data, f"Missing expected branding setting key: {key}"
        assert isinstance(data[key], (str, type(None))), f"Branding setting '{key}' should be string or null"

test_branding_endpoint_returns_public_branding_settings()