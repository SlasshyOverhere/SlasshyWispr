import pytest
import sys
import os

# Add the current directory to sys.path so we can import coqui_bridge
sys.path.append(os.path.dirname(__file__))

from coqui_bridge import build_quality_kwargs

def test_build_quality_kwargs_fast():
    expected = {
        "temperature": 0.92,
        "top_k": 30,
        "top_p": 0.78,
        "repetition_penalty": 7.5,
    }
    assert build_quality_kwargs("fast") == expected
    assert build_quality_kwargs("FAST") == expected
    assert build_quality_kwargs(" fast ") == expected

def test_build_quality_kwargs_high():
    expected = {
        "temperature": 0.62,
        "top_k": 70,
        "top_p": 0.94,
        "repetition_penalty": 12.0,
        "length_penalty": 1.0,
    }
    assert build_quality_kwargs("high") == expected
    assert build_quality_kwargs("HIGH") == expected
    assert build_quality_kwargs(" high ") == expected

def test_build_quality_kwargs_balanced():
    expected = {
        "temperature": 0.75,
        "top_k": 50,
        "top_p": 0.86,
        "repetition_penalty": 10.0,
    }
    assert build_quality_kwargs("balanced") == expected
    assert build_quality_kwargs("BALANCED") == expected
    assert build_quality_kwargs(" balanced ") == expected

def test_build_quality_kwargs_default():
    expected = {
        "temperature": 0.75,
        "top_k": 50,
        "top_p": 0.86,
        "repetition_penalty": 10.0,
    }
    assert build_quality_kwargs("") == expected
    assert build_quality_kwargs(None) == expected
    assert build_quality_kwargs("unknown_quality") == expected
