#!/usr/bin/env python3
"""Regression tests for vendored UI/UX Pro Max upstream fixes."""

import csv
import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent
sys.path.insert(0, str(SCRIPT_DIR))

from core import search  # noqa: E402
from design_system import resolve_preview_locale, _query_wants_dark  # noqa: E402


class PreviewLocaleTests(unittest.TestCase):
    def test_ambiguous_rtl_scripts_do_not_guess_language(self):
        for sample in ("العربية", "فارسی", "اردو", "ייִדיש"):
            with self.subTest(sample=sample):
                self.assertEqual(resolve_preview_locale(sample), ("und", "rtl"))

    def test_explicit_rtl_locale_is_preserved(self):
        self.assertEqual(resolve_preview_locale("فارسی", lang="fa-IR"), ("fa-IR", "rtl"))

    def test_explicit_rtl_script_subtag_controls_direction(self):
        self.assertEqual(resolve_preview_locale("Azeri", lang="az-Arab"), ("az-Arab", "rtl"))
        self.assertEqual(resolve_preview_locale("Azeri", lang="az-Latn"), ("az-Latn", "ltr"))

    def test_explicit_direction_overrides_locale_default(self):
        self.assertEqual(resolve_preview_locale("English", lang="en", direction="rtl"), ("en", "rtl"))


class DarkModeAliasTests(unittest.TestCase):
    def test_arabic_dark_mode_aliases_select_dark_mode(self):
        self.assertTrue(_query_wants_dark("داكن"))
        self.assertTrue(_query_wants_dark("مظلم"))


class ColorSearchTests(unittest.TestCase):
    def test_three_digit_hex_matches_equivalent_six_digit_hex(self):
        short = search("#fff", "color", 5)
        full = search("#ffffff", "color", 5)
        self.assertGreater(short["count"], 0)
        self.assertEqual(short["results"], full["results"])


class PySideExampleTests(unittest.TestCase):
    def test_good_and_bad_examples_are_not_reversed(self):
        path = SKILL_DIR / "data" / "stacks" / "pyside6-qss.csv"
        with path.open(encoding="utf-8", newline="") as handle:
            rows = {row["No"]: row for row in csv.DictReader(handle)}

        expected = {
            "2": ("setThemeColor(ThemeColor.LIGHT_1)", 'widget.setStyleSheet("color: #3B82F6")'),
            "4": ("layout.setSpacing(16)", "layout = QVBoxLayout(); layout.addWidget(card)"),
            "11": ("QTimer.singleShot(200, self.on_ready)", "time.sleep(0.2)"),
            "9": ("self._expand_anim = QPropertyAnimation(self, b'maximumWidth')", "anim = QPropertyAnimation(self, b'maximumWidth')"),
            "15": ("self.worker.progress.connect(self.on_progress, Qt.QueuedConnection)", "self.worker.progress.connect(self.on_progress)"),
            "28": ("btn.setAccessibleName('Close window')", "btn.setToolTip('Close window')"),
        }
        for number, (good, bad) in expected.items():
            with self.subTest(row=number):
                self.assertEqual(rows[number]["Code Good"], good)
                self.assertEqual(rows[number]["Code Bad"], bad)


if __name__ == "__main__":
    unittest.main()
