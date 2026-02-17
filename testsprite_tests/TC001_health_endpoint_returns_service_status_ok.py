import requests

def test_health_endpoint_returns_status_ok():
    base_url = "http://localhost:8080"
    url = f"{base_url}/health"
    headers = {
        "Accept": "application/json"
    }
    try:
        response = requests.get(url, headers=headers, timeout=30)
        response.raise_for_status()
    except requests.RequestException as e:
        assert False, f"Request to /health endpoint failed: {e}"

    try:
        _ = response.json()
    except ValueError:
        assert False, "Response from /health endpoint is not valid JSON"


test_health_endpoint_returns_status_ok()