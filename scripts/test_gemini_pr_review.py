import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from gemini_pr_review import render_comment


class GeminiReviewContractTests(unittest.TestCase):
    def test_truncated_diff_cannot_pass(self):
        # The HTTP layer is deliberately not called; test the deterministic guard
        # by mocking the response contract parser at the request boundary.
        import gemini_pr_review as review

        original = review._request_json
        review._request_json = lambda *args, **kwargs: {
            "candidates": [{
                "content": {"parts": [{
                    "text": '{"verdict":"PASS","summary":"Looks good","coverage":"complete","findings":[]}'
                }]}
            }]
        }
        try:
            result = review.review_diff(
                api_key="not-a-real-key",
                title="title",
                body="body",
                head_sha="a" * 40,
                files=[{"filename": "server/example.ts"}],
                diff="FILE: server/example.ts\n+const x = 1;",
                truncated=True,
            )
        finally:
            review._request_json = original
        self.assertEqual(result["verdict"], "BLOCKED")
        self.assertEqual(result["coverage"], "partial")

    def test_findings_must_reference_a_changed_file(self):
        import gemini_pr_review as review

        original = review._request_json
        review._request_json = lambda *args, **kwargs: {
            "candidates": [{
                "content": {"parts": [{
                    "text": '{"verdict":"PASS","summary":"Looks good","coverage":"complete","findings":['
                    '{"severity":"high","file":"secret.txt","line":1,"title":"Leak",'
                    '"evidence":"Not in the diff","recommendation":"Fix it"}]}'
                }]}
            }]
        }
        try:
            result = review.review_diff(
                api_key="not-a-real-key",
                title="title",
                body="body",
                head_sha="b" * 40,
                files=[{"filename": "server/example.ts"}],
                diff="FILE: server/example.ts\n+const x = 1;",
                truncated=False,
            )
        finally:
            review._request_json = original
        self.assertEqual(result["verdict"], "BLOCKED")
        self.assertEqual(result["coverage"], "partial")
        self.assertEqual(result["findings"], [])

    def test_valid_high_severity_finding_cannot_pass(self):
        import gemini_pr_review as review

        original = review._request_json
        review._request_json = lambda *args, **kwargs: {
            "candidates": [{
                "content": {"parts": [{
                    "text": '{"verdict":"PASS","summary":"Looks good","coverage":"complete","findings":['
                    '{"severity":"high","file":"server/example.ts","line":3,"title":"Missing auth",'
                    '"evidence":"Handler is unprotected","recommendation":"Require a principal"}]}'
                }]}
            }]
        }
        try:
            result = review.review_diff(
                api_key="not-a-real-key",
                title="title",
                body="body",
                head_sha="c" * 40,
                files=[{"filename": "server/example.ts"}],
                diff="FILE: server/example.ts\n+app.get('/admin', handler);",
                truncated=False,
            )
        finally:
            review._request_json = original
        self.assertEqual(result["verdict"], "NEEDS_CHANGES")
        self.assertEqual(result["coverage"], "complete")
        self.assertEqual(len(result["findings"]), 1)

    def test_comment_escapes_model_html_and_mentions(self):
        comment = render_comment({
            "verdict": "NEEDS_CHANGES",
            "coverage": "complete",
            "summary": "<script>alert(1)</script> @owner",
            "findings": [{
                "severity": "high",
                "file": "server/example.ts",
                "line": 7,
                "title": "<img src=x>",
                "evidence": "Missing guard @here",
                "recommendation": "Add a check",
            }],
        }, "d" * 40)
        self.assertNotIn("<script>", comment)
        self.assertNotIn("<img", comment)
        self.assertIn("&lt;script&gt;", comment)
        self.assertIn("@&#8203;owner", comment)
        self.assertIn("server/example.ts:7", comment)

    def test_complete_clean_review_can_pass(self):
        import gemini_pr_review as review

        original = review._request_json
        review._request_json = lambda *args, **kwargs: {
            "candidates": [{
                "content": {"parts": [{
                    "text": '{"verdict":"PASS","summary":"No actionable findings in the supplied diff.",'
                    '"coverage":"complete","findings":[]}'
                }]}
            }]
        }
        try:
            result = review.review_diff(
                api_key="not-a-real-key",
                title="title",
                body="body",
                head_sha="e" * 40,
                files=[{"filename": "server/example.ts"}],
                diff="FILE: server/example.ts\n+const x = 1;",
                truncated=False,
            )
        finally:
            review._request_json = original
        self.assertEqual(result["verdict"], "PASS")
        self.assertEqual(result["coverage"], "complete")

    def test_gemini_api_key_is_sent_in_header_not_url(self):
        import gemini_pr_review as review
        from unittest.mock import patch

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return b'{}'

        secret = "test-key-never-in-url"
        with patch.object(review.urllib.request, "urlopen", return_value=FakeResponse()) as mocked:
            review._request_json(
                review.GEMINI_API,
                api_key=secret,
                method="POST",
                payload={"test": True},
            )
        request = mocked.call_args.args[0]
        self.assertNotIn(secret, request.full_url)
        self.assertEqual(request.get_header("X-goog-api-key"), secret)

    def test_pr_target_branch_is_validated(self):
        import gemini_pr_review as review
        from unittest.mock import patch

        good_pr = {
            "state": "open",
            "base": {"ref": "main"},
            "head": {"sha": "f" * 40},
        }
        with patch.object(review, "_request_json", return_value=good_pr):
            self.assertEqual(review.fetch_pr("org/repo", 1, "token")["head"]["sha"], "f" * 40)
        with patch.object(review, "_request_json", return_value={
            "state": "open", "base": {"ref": "release"}, "head": {"sha": "f" * 40}
        }):
            with self.assertRaises(review.ReviewError):
                review.fetch_pr("org/repo", 1, "token")

    def test_missing_file_patch_marks_coverage_partial(self):
        import gemini_pr_review as review
        from unittest.mock import patch

        with patch.object(review, "_request_json", side_effect=[
            [{"filename": "assets/image.png", "patch": None}],
            [],
        ]):
            files, diff, truncated = review.fetch_files_and_diff("org/repo", 1, "token")
        self.assertEqual(files[0]["filename"], "assets/image.png")
        self.assertIn("Patch unavailable", diff)
        self.assertTrue(truncated)

    def test_existing_review_comment_is_updated_not_duplicated(self):
        import gemini_pr_review as review
        from unittest.mock import patch

        calls = []
        def fake_request(url, **kwargs):
            calls.append((url, kwargs))
            if kwargs.get("method", "GET") == "GET":
                return [{"id": 123, "body": review.COMMENT_MARKER + "\nold report", "user": {"login": "github-actions[bot]"}}]
            return {"id": 123, "body": kwargs["payload"]["body"]}

        with patch.object(review, "_request_json", side_effect=fake_request):
            review.post_comment("org/repo", 5, "token", review.COMMENT_MARKER + "\nnew report")
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[1][1]["method"], "PATCH")
        self.assertIn("/issues/comments/123", calls[1][0])

    def test_same_complete_head_skips_duplicate_gemini_review(self):
        import gemini_pr_review as review

        head = "a" * 40
        comment = {
            "body": review.render_comment({
                "verdict": "PASS", "coverage": "complete",
                "summary": "No actionable findings.", "findings": [],
            }, head),
            "updated_at": "2026-11-06T08:00:00Z",
        }
        reason = review.review_throttle_reason(comment, head)
        self.assertIn("already has a complete advisory review", reason)

    def test_recent_review_throttles_new_head_for_ten_minutes(self):
        import gemini_pr_review as review

        now = datetime(2026, 11, 6, 8, 5, tzinfo=timezone.utc)
        comment = {"body": "previous review", "updated_at": "2026-11-06T08:00:00Z"}
        reason = review.review_throttle_reason(comment, "b" * 40, now=now)
        self.assertIn("cooldown active", reason)
        self.assertIsNone(review.review_throttle_reason(
            comment, "b" * 40, now=now + timedelta(minutes=6)
        ))

    def test_missing_review_timestamp_fails_closed(self):
        import gemini_pr_review as review

        reason = review.review_throttle_reason({"body": "prior review"}, "c" * 40)
        self.assertIn("timestamp is unavailable", reason)

    def test_secret_bearing_workflow_has_no_branch_selectable_dispatch(self):
        workflow = Path(__file__).parents[1] / ".github/workflows/gemini-ai-review.yml"
        text = workflow.read_text()
        self.assertNotIn("workflow_dispatch", text)
        self.assertIn("pull-requests: read", text)
        self.assertIn("issues: write", text)
        self.assertNotIn("pull-requests: write", text)

    def test_review_slot_is_persisted_before_billable_call(self):
        import gemini_pr_review as review
        from unittest.mock import patch

        response = {"id": 456, "body": review.COMMENT_MARKER, "updated_at": "2026-11-06T08:00:00Z"}
        with patch.object(review, "_request_json", return_value=response) as mocked:
            result = review.reserve_review_slot("org/repo", 9, "token", "d" * 40, None)
        self.assertEqual(result["id"], 456)
        args, kwargs = mocked.call_args
        self.assertEqual(kwargs["method"], "POST")
        self.assertIn("reserved before calling Gemini", kwargs["payload"]["body"])

    def test_existing_review_slot_is_updated_in_place(self):
        import gemini_pr_review as review
        from unittest.mock import patch

        existing = {"id": 789}
        response = {"id": 789, "body": review.COMMENT_MARKER, "updated_at": "2026-11-06T08:00:00Z"}
        with patch.object(review, "_request_json", return_value=response) as mocked:
            result = review.reserve_review_slot("org/repo", 9, "token", "e" * 40, existing)
        self.assertEqual(result["id"], 789)
        self.assertEqual(mocked.call_args.kwargs["method"], "PATCH")
        self.assertIn("/issues/comments/789", mocked.call_args.args[0])

    def test_redacts_credentials_from_all_prompt_inputs_and_blocks_pass(self):
        import gemini_pr_review as review
        from unittest.mock import patch

        secret = "ghp_" + "A" * 36
        captured = {}
        def fake_request(_url, **kwargs):
            captured["prompt"] = kwargs["payload"]["contents"][0]["parts"][0]["text"]
            return {"candidates": [{"content": {"parts": [{
                "text": '{"verdict":"PASS","summary":"Looks good","coverage":"complete","findings":[]}'
            }]}}]}

        with patch.object(review, "_request_json", side_effect=fake_request):
            result = review.review_diff(
                api_key="not-a-real-key",
                title="Title",
                body=f"Leaked token: {secret}",
                head_sha="f" * 40,
                files=[{"filename": "server/example.ts"}],
                diff=f"FILE: server/example.ts\n+const token = '{secret}';",
                truncated=False,
            )
        self.assertNotIn(secret, captured["prompt"])
        self.assertIn("[REDACTED]", captured["prompt"])
        self.assertEqual(result["verdict"], "BLOCKED")
        self.assertEqual(result["coverage"], "partial")

    def test_redacts_private_keys_and_database_urls(self):
        import gemini_pr_review as review

        private_key = "-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----"
        database_url = "postgresql://user:password@db.example.test:5432/prodx"
        value, changed = review.redact_sensitive_data(private_key + "\n" + database_url)
        self.assertTrue(changed)
        self.assertNotIn("private-material", value)
        self.assertNotIn("user:password", value)
        self.assertIn("[REDACTED PRIVATE KEY]", value)
        self.assertIn("[REDACTED DATABASE URL]", value)

    def test_global_cooldown_limits_calls_across_different_prs(self):
        import gemini_pr_review as review
        from unittest.mock import patch

        now = datetime(2026, 11, 6, 8, 5, tzinfo=timezone.utc)
        response = {"workflow_runs": [
            {"id": 101, "created_at": "2026-11-06T08:03:00Z"},
            {"id": 202, "created_at": "2026-11-06T08:05:00Z"},
        ]}
        with patch.object(review, "_request_json", return_value=response) as mocked:
            reason = review.global_review_throttle_reason(
                "org/repo", "token", "202", now=now
            )
        self.assertIn("Repository-wide", reason)
        self.assertIn("/actions/workflows/gemini-ai-review.yml/runs", mocked.call_args.args[0])

    def test_global_cooldown_allows_review_after_five_minutes(self):
        import gemini_pr_review as review
        from unittest.mock import patch

        now = datetime(2026, 11, 6, 8, 10, tzinfo=timezone.utc)
        response = {"workflow_runs": [{"id": 101, "created_at": "2026-11-06T08:03:00Z"}]}
        with patch.object(review, "_request_json", return_value=response):
            self.assertIsNone(review.global_review_throttle_reason(
                "org/repo", "token", "202", now=now
            ))

    def test_model_verdict_does_not_control_workflow_success(self):
        import os
        import gemini_pr_review as review
        from unittest.mock import patch

        pr = {"head": {"sha": "a" * 40}, "title": "test", "body": "test"}
        env = {
            "GITHUB_REPOSITORY": "org/repo",
            "GITHUB_TOKEN": "token",
            "PR_NUMBER": "9",
            "GITHUB_RUN_ID": "202",
            "GEMINI_API_KEY": "not-a-real-key",
        }
        report = {"verdict": "NEEDS_CHANGES", "coverage": "complete",
                  "findings": [{"severity": "high"}]}
        with patch.dict(os.environ, env), \
             patch.object(review, "fetch_pr", side_effect=[pr, pr]), \
             patch.object(review, "global_review_throttle_reason", return_value=None), \
             patch.object(review, "find_existing_review_comment", return_value=None), \
             patch.object(review, "review_throttle_reason", return_value=None), \
             patch.object(review, "reserve_review_slot", return_value={"id": 1}), \
             patch.object(review, "fetch_files_and_diff", return_value=([{"filename": "server/a.py"}], "diff", False)), \
             patch.object(review, "review_diff", return_value=report), \
             patch.object(review, "post_comment"):
            self.assertEqual(review.main(), 0)

    def test_secret_bearing_workflow_has_global_budget_and_is_non_gating(self):
        workflow = Path(__file__).parents[1] / ".github/workflows/gemini-ai-review.yml"
        text = workflow.read_text()
        self.assertIn("actions: read", text)
        self.assertIn("group: gemini-ai-review-global", text)
        self.assertIn("cancel-in-progress: false", text)
        self.assertIn("non-gating", text)
        self.assertIn("author_association == 'OWNER'", text)
        self.assertIn("author_association == 'COLLABORATOR'", text)
        self.assertNotIn("workflow_dispatch", text)

if __name__ == "__main__":
    unittest.main()
