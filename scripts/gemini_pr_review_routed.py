#!/usr/bin/env python3
"""Model-router entry point; delegates review contract to the existing trusted reviewer."""
from __future__ import annotations

import gemini_pr_review as review
from gemini_model_router import generate_content_url, selected_model

# Resolve from a strict allowlist before the reviewer performs any billable call.
_SELECTED_MODEL = selected_model()
review.GEMINI_API = generate_content_url(_SELECTED_MODEL)

if not hasattr(review, "_router_original_review_diff"):
    review._router_original_review_diff = review.review_diff
    review._router_original_render_comment = review.render_comment
_original_review_diff = review._router_original_review_diff
_original_render_comment = review._router_original_render_comment


def _review_diff_with_model(*args, **kwargs):
    result = _original_review_diff(*args, **kwargs)
    result["model"] = _SELECTED_MODEL
    return result


def _render_comment_with_model(result, head_sha):
    body = _original_render_comment(result, head_sha)
    model = result.get("model", _SELECTED_MODEL)
    marker = "<p><em>This is an AI review"
    return body.replace(marker, f"<p><strong>Model:</strong> {model}</p>" + marker, 1)


review.review_diff = _review_diff_with_model
review.render_comment = _render_comment_with_model

if __name__ == "__main__":
    raise SystemExit(review.main())
