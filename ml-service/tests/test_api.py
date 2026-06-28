import os
import sys
import pytest
from fastapi.testclient import TestClient

# Adjust path to import app correctly
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.main import app

client = TestClient(app)

def test_predict_endpoint():
    """Verify that the predict endpoint returns the correct structure and classifications."""
    payload = {
        "caption": "Get our exclusive discount of 20% now! Order today by visiting our bio links. #promo #discount #shopping",
        "format": "Carousel",
        "post_hour": 19,
        "brand_id": "bfd6dbca-613d-4950-8b1e-45ad7dcf1088",
        "niche": "Fashion"
      }
    response = client.post("/predict", json=payload)
    assert response.status_code == 200
    
    data = response.json()
    assert data["status"] == "success"
    assert "predicted_class" in data
    assert "confidence" in data
    assert "probabilities" in data
    assert "model_metadata" in data
    
    # Assert proper title-cased classification values from mapping
    assert data["predicted_class"] in ["High", "Average", "Low"]
    assert "High" in data["probabilities"]
    assert "Average" in data["probabilities"]
    assert "Low" in data["probabilities"]

def test_suggest_endpoint():
    """Verify that the template recommendation engine returns proper heuristics advice."""
    payload = {
        "caption": "A short draft post.",
        "format": "Single Image",
        "post_hour": 9,
        "brand_id": "bfd6dbca-613d-4950-8b1e-45ad7dcf1088"
    }
    response = client.post("/suggest", json=payload)
    assert response.status_code == 200
    
    data = response.json()
    assert data["status"] == "success"
    assert "features_analyzed" in data
    assert "recommendations" in data
    
    # Assert details are returned
    recs = data["recommendations"]
    assert len(recs) > 0
    # The hour 9 is outside peak window (17-21) and caption is short, should recommend changes
    parameters_flagged = [r["parameter"] for r in recs]
    assert "post_hour" in parameters_flagged
    assert "caption_length" in parameters_flagged
    assert "has_cta" in parameters_flagged

def test_train_endpoint():
    """Verify that retraining queueing works asynchronously."""
    payload = {
        "brand_id": "bfd6dbca-613d-4950-8b1e-45ad7dcf1088",
        "niche": "Fashion"
    }
    response = client.post("/train", json=payload)
    assert response.status_code == 200
    
    data = response.json()
    assert data["status"] == "pending"
    assert "job_id" in data
    assert "message" in data
