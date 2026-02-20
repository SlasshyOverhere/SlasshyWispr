import os
import sys
import unittest

# Add the current directory to sys.path so we can import coqui_bridge
sys.path.append(os.path.dirname(__file__))

from coqui_bridge import build_quality_kwargs

class BuildQualityKwargsTests(unittest.TestCase):
    def test_build_quality_kwargs_fast(self):
        expected = {
            "temperature": 0.92,
            "top_k": 30,
            "top_p": 0.78,
            "repetition_penalty": 7.5,
        }
        self.assertEqual(build_quality_kwargs("fast"), expected)
        self.assertEqual(build_quality_kwargs("FAST"), expected)
        self.assertEqual(build_quality_kwargs(" fast "), expected)

    def test_build_quality_kwargs_high(self):
        expected = {
            "temperature": 0.62,
            "top_k": 70,
            "top_p": 0.94,
            "repetition_penalty": 12.0,
            "length_penalty": 1.0,
        }
        self.assertEqual(build_quality_kwargs("high"), expected)
        self.assertEqual(build_quality_kwargs("HIGH"), expected)
        self.assertEqual(build_quality_kwargs(" high "), expected)

    def test_build_quality_kwargs_balanced(self):
        expected = {
            "temperature": 0.75,
            "top_k": 50,
            "top_p": 0.86,
            "repetition_penalty": 10.0,
        }
        self.assertEqual(build_quality_kwargs("balanced"), expected)
        self.assertEqual(build_quality_kwargs("BALANCED"), expected)
        self.assertEqual(build_quality_kwargs(" balanced "), expected)

    def test_build_quality_kwargs_default(self):
        expected = {
            "temperature": 0.75,
            "top_k": 50,
            "top_p": 0.86,
            "repetition_penalty": 10.0,
        }
        self.assertEqual(build_quality_kwargs(""), expected)
        self.assertEqual(build_quality_kwargs(None), expected)
        self.assertEqual(build_quality_kwargs("unknown_quality"), expected)


if __name__ == "__main__":
    unittest.main()
