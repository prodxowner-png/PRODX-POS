import importlib
import unittest
from pathlib import Path
from unittest.mock import patch

import gemini_model_router as router


class GeminiModelRouterTests(unittest.TestCase):
    def test_default_is_gemini_38_flash(self):
        with patch.dict("os.environ", {}, clear=True):
            self.assertEqual(router.selected_model(), "gemini-3.8-flash")

    def test_gemini_31_pro_uses_preview_model_id(self):
        with patch.dict("os.environ", {"AI_REVIEW_MODEL": "gemini-3.1-pro-preview"}):
            self.assertEqual(router.selected_model(), "gemini-3.1-pro-preview")

    def test_neon_and_argon_are_not_sent_to_developer_api(self):
        for model in ("gemini-4-neon", "gemini-4-argon"):
            with self.subTest(model=model), patch.dict("os.environ", {"AI_REVIEW_MODEL": model}):
                with self.assertRaises(router.ModelRouteError):
                    router.selected_model()

    def test_unknown_model_fails_closed(self):
        with patch.dict("os.environ", {"AI_REVIEW_MODEL": "unknown-model"}):
            with self.assertRaises(router.ModelRouteError):
                router.selected_model()

    def test_model_id_is_allowlisted_when_building_url(self):
        self.assertEqual(
            router.generate_content_url("gemini-3.8-flash"),
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
        )
        with self.assertRaises(router.ModelRouteError):
            router.generate_content_url("gemini-4-neon")

    def test_diagnostic_probes_only_models_returned_by_models_list(self):
        listing = {"models": [
            {"name": "models/gemini-3.8-flash", "supportedGenerationMethods": ["generateContent"]},
            {"name": "models/gemini-3.1-pro-preview", "supportedGenerationMethods": ["generateContent"]},
        ]}
        with patch.object(router, "_request_json", side_effect=[listing, {}, {}]) as request:
            report = router.diagnose_developer_api("test-key")
        self.assertEqual(set(report["models"].values()), {"PASS"})
        self.assertEqual(request.call_count, 3)
        self.assertIn("gemini-4-neon", report["agent_platform"])
        self.assertIn("NOT_TESTED", report["agent_platform"]["gemini-4-neon"])

    def test_diagnostic_workflow_has_no_user_selected_ref_or_write_permissions(self):
        workflow = Path(__file__).parents[1] / ".github/workflows/gemini-model-capability-diagnostic.yml"
        text = workflow.read_text()
        self.assertIn("workflow_dispatch:", text)
        self.assertIn("ref: ${{ github.event.repository.default_branch }}", text)
        self.assertIn("contents: read", text)
        self.assertNotIn("inputs:", text)
        self.assertNotIn("contents: write", text)

    def test_routed_entrypoint_uses_selected_model_and_annotates_report(self):
        with patch.dict("os.environ", {"AI_REVIEW_MODEL": "gemini-3.1-pro-preview"}):
            import gemini_pr_review_routed as routed
            importlib.reload(routed)
        self.assertIn("gemini-3.1-pro-preview", routed.review.GEMINI_API)
        comment = routed.review.render_comment(
            {"verdict": "BLOCKED", "coverage": "partial", "summary": "blocked", "findings": []},
            "a" * 40,
        )
        self.assertIn("Model:</strong> gemini-3.1-pro-preview", comment)

    def test_api_key_is_header_not_url(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def read(self): return b'{"models": []}'
        with patch.object(router.urllib.request, "urlopen", return_value=Response()) as mocked:
            router._request_json(f"{router.GEMINI_API_BASE}/models", "secret-test-key")
        request = mocked.call_args.args[0]
        self.assertNotIn("secret-test-key", request.full_url)
        self.assertEqual(request.get_header("X-goog-api-key"), "secret-test-key")


if __name__ == "__main__":
    unittest.main()
