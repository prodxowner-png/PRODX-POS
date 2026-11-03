import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch, Mock
import gemini_code_agent as agent

class GeminiEndpointTests(unittest.TestCase):
    def test_uses_gemini_4_argon_model_for_generation(self):
        self.assertEqual(agent.GEMINI_MODEL, 'gemini-4-argon')
        self.assertEqual(
            agent.GEMINI_API,
            'https://generativelanguage.googleapis.com/v1beta1/models/gemini-4-argon:generateContent',
        )
        self.assertNotIn('key=', agent.GEMINI_API.lower())
        self.assertEqual(agent.GITHUB_REQUEST_TIMEOUT_SECONDS, 30)
        self.assertEqual(agent.GEMINI_REQUEST_TIMEOUT_SECONDS, 1_200)
        self.assertEqual(agent.GEMINI_MAX_OUTPUT_TOKENS, 131_072)

    def test_request_uses_configured_long_timeout(self):
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = b'{"ok": true}'
        with patch.object(agent.urllib.request, 'urlopen', return_value=response) as urlopen:
            result = agent.request_json('https://example.invalid/test')
        self.assertEqual(result, {"ok": True})
        urlopen.assert_called_once()
        self.assertEqual(urlopen.call_args.kwargs['timeout'], agent.GITHUB_REQUEST_TIMEOUT_SECONDS)

    def test_generation_sends_configured_output_budget_to_gemini(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict('os.environ', {
            'GITHUB_REPOSITORY': 'Prodx-organization/PRODX-POS',
            'GITHUB_TOKEN': 'test-token',
            'GEMINI_API_KEY': 'test-api-key',
        }), patch.object(agent, 'issue_context', return_value=('Small task', 'Add a documentation note.')), \
             patch.object(agent, 'gather_context', return_value='minimal context'), \
             patch.object(agent, 'request_json', return_value={
                 'candidates': [{'content': {'parts': [{'text': json.dumps({
                     'summary': 'Add a note',
                     'files': [{'path': 'docs/agent-test.md', 'content': 'Regression test output.\n'}],
                 })}]}, 'finishReason': 'STOP'}],
             }) as request_json:
            output = pathlib.Path(temp) / 'candidate.json'
            agent.generate(164, output)
            self.assertEqual(json.loads(output.read_text())['files'][0]['path'], 'docs/agent-test.md')
        request_json.assert_called_once()
        args, kwargs = request_json.call_args
        self.assertEqual(args[0], agent.GEMINI_API)
        self.assertEqual(kwargs['api_key'], 'test-api-key')
        self.assertEqual(kwargs['payload']['generationConfig']['maxOutputTokens'], 131_072)
        self.assertEqual(kwargs['timeout_seconds'], 1_200)

    def test_continues_empty_reasoning_hop_using_latest_continuation_token(self):
        final_json = json.dumps({
            'summary': 'Add a note',
            'files': [{'path': 'docs/agent-test.md', 'content': 'Continuation succeeded.\n'}],
        })
        first = {'candidates': [{
            'content': {'role': 'model', 'parts': [{'text': ''}]},
            'finishReason': 'CONTINUATION', 'continuationToken': 'opaque-token-1',
        }], 'usageMetadata': {'candidatesTokenCount': 0}}
        second = {'candidates': [{
            'content': {'role': 'model', 'parts': [{'text': final_json}]},
            'finishReason': 'STOP',
        }]}
        with tempfile.TemporaryDirectory() as temp, patch.dict('os.environ', {
            'GITHUB_REPOSITORY': 'Prodx-organization/PRODX-POS',
            'GITHUB_TOKEN': 'test-token',
            'GEMINI_API_KEY': 'test-api-key',
        }), patch.object(agent, 'issue_context', return_value=('Small task', 'Add a documentation note.')), \
             patch.object(agent, 'gather_context', return_value='minimal context'), \
             patch.object(agent, 'request_json', side_effect=[first, second]) as request_json:
            output = pathlib.Path(temp) / 'candidate.json'
            agent.generate(164, output)
            self.assertEqual(json.loads(output.read_text())['files'][0]['path'], 'docs/agent-test.md')
        self.assertEqual(request_json.call_count, 2)
        first_payload = request_json.call_args_list[0].kwargs['payload']
        second_payload = request_json.call_args_list[1].kwargs['payload']
        self.assertNotIn('continuationToken', first_payload)
        self.assertEqual(second_payload['continuationToken'], 'opaque-token-1')
        self.assertEqual(first_payload['contents'], second_payload['contents'])
        self.assertEqual(first_payload['generationConfig'], second_payload['generationConfig'])
        self.assertEqual(request_json.call_args_list[0].kwargs['timeout_seconds'], 1_200)

    def test_continuation_without_token_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict('os.environ', {
            'GITHUB_REPOSITORY': 'Prodx-organization/PRODX-POS',
            'GITHUB_TOKEN': 'test-token',
            'GEMINI_API_KEY': 'test-api-key',
        }), patch.object(agent, 'issue_context', return_value=('Small task', 'Add a documentation note.')), \
             patch.object(agent, 'gather_context', return_value='minimal context'), \
             patch.object(agent, 'request_json', return_value={
                 'candidates': [{'content': {'parts': []}, 'finishReason': 'CONTINUATION'}],
             }):
            with self.assertRaisesRegex(agent.AgentError, 'continuation without a usable token'):
                agent.generate(164, pathlib.Path(temp) / 'candidate.json')

    def test_empty_candidate_response_reports_safe_model_diagnostics(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict('os.environ', {
            'GITHUB_REPOSITORY': 'Prodx-organization/PRODX-POS',
            'GITHUB_TOKEN': 'test-token',
            'GEMINI_API_KEY': 'test-api-key',
        }), patch.object(agent, 'issue_context', return_value=('Small task', 'Add a documentation note.')), \
             patch.object(agent, 'gather_context', return_value='minimal context'), \
             patch.object(agent, 'request_json', return_value={
                 'candidates': [{'content': {'parts': []}, 'finishReason': 'STOP'}],
                 'usageMetadata': {'candidatesTokenCount': 0},
             }):
            with self.assertRaisesRegex(agent.AgentError, r'model=gemini-4-argon, finishReason=STOP.*outputTokens=0'):
                agent.generate(164, pathlib.Path(temp) / 'candidate.json')

    def test_blocked_prompt_reports_reason_without_response_body(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict('os.environ', {
            'GITHUB_REPOSITORY': 'Prodx-organization/PRODX-POS',
            'GITHUB_TOKEN': 'test-token',
            'GEMINI_API_KEY': 'test-api-key',
        }), patch.object(agent, 'issue_context', return_value=('Small task', 'Add a documentation note.')), \
             patch.object(agent, 'gather_context', return_value='minimal context'), \
             patch.object(agent, 'request_json', return_value={'promptFeedback': {'blockReason': 'SAFETY'}}):
            with self.assertRaisesRegex(agent.AgentError, r'no candidates \(SAFETY\); model=gemini-4-argon'):
                agent.generate(164, pathlib.Path(temp) / 'candidate.json')

class PathPolicyTests(unittest.TestCase):
    def test_allows_source_and_regression_test_paths(self):
        self.assertEqual(agent.validate_path('server/http/example.test.ts'), 'server/http/example.test.ts')
        self.assertEqual(agent.validate_path('db/migrations/0099_new_guard.sql'), 'db/migrations/0099_new_guard.sql')
        self.assertEqual(agent.validate_path('docs/security-note.md'), 'docs/security-note.md')

    def test_rejects_traversal_absolute_and_backslash(self):
        for value in ('../outside.txt', '/tmp/outside.txt', 'server/../../outside.ts', 'server\\evil.ts'):
            with self.subTest(value=value), self.assertRaises(agent.AgentError):
                agent.validate_path(value)

    def test_rejects_workflows_credentials_and_package_manifests(self):
        for value in ('.github/workflows/evil.yml', '.env', '.env.production', 'config/service.key',
                      'certs/signing.pem', 'server/secret_store.ts', 'server/user_credentials.ts',
                      'scripts/ci/release.py', 'scripts/deploy/prod.sh', 'package.json', 'package-lock.json',
                      'scripts/gemini_code_agent.py', 'scripts/gemini_pr_review.py', 'node_modules/x.js'):
            with self.subTest(value=value), self.assertRaises(agent.AgentError):
                agent.validate_path(value)

    def test_rejects_nested_manifests_and_control_directories(self):
        for path in (
            'server/package.json', 'src/pnpm-lock.yaml', 'server/.npmrc',
            'server/bun.lock', 'server/.github/workflows/unsafe.yml',
            'src/.git/config', 'tests/node_modules/pkg/index.js',
        ):
            with self.subTest(path=path), self.assertRaises(agent.AgentError):
                agent.validate_path(path)

    def test_rejects_paths_outside_source_policy(self):
        with self.assertRaises(agent.AgentError):
            agent.validate_path('vercel.json')

class ArtifactTests(unittest.TestCase):
    def test_rejects_entire_artifact_before_writing_any_file(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            artifact = root / 'candidate.json'
            artifact.write_text(json.dumps({'files': [
                {'path': 'server/new.ts', 'content': 'safe'},
                {'path': '.github/workflows/pwn.yml', 'content': 'bad'}]}))
            with patch.object(pathlib.Path, 'cwd', return_value=root):
                with self.assertRaises(agent.AgentError):
                    agent.apply_artifact(artifact)
            self.assertFalse((root / 'server/new.ts').exists())

    def test_rejects_oversized_aggregate_before_writing_any_file(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            artifact = root / 'candidate.json'
            artifact.write_text(json.dumps({'files': [
                {'path': 'server/first.ts', 'content': 'a' * 400_000},
                {'path': 'server/second.ts', 'content': 'b' * 400_000},
                {'path': 'server/third.ts', 'content': 'c' * 400_000}]}))
            import os
            old = os.getcwd()
            try:
                os.chdir(root)
                with self.assertRaisesRegex(agent.AgentError, 'total output size limit'):
                    agent.apply_artifact(artifact)
            finally:
                os.chdir(old)
            self.assertFalse((root / 'server/first.ts').exists())
            self.assertFalse((root / 'server/second.ts').exists())
            self.assertFalse((root / 'server/third.ts').exists())

    def test_rejects_symlink_escape(self):
        with tempfile.TemporaryDirectory() as temp, tempfile.TemporaryDirectory() as outside:
            root = pathlib.Path(temp)
            (root / 'server').symlink_to(outside, target_is_directory=True)
            artifact = root / 'candidate.json'
            artifact.write_text(json.dumps({'files': [{'path': 'server/escaped.ts', 'content': 'bad'}]}))
            import os
            old = os.getcwd()
            try:
                os.chdir(root)
                with self.assertRaises(agent.AgentError):
                    agent.apply_artifact(artifact)
            finally:
                os.chdir(old)
            self.assertFalse((pathlib.Path(outside) / 'escaped.ts').exists())

    def test_rejects_symlink_alias_to_protected_directory(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            protected = root / '.github' / 'workflows'
            protected.mkdir(parents=True)
            protected_file = protected / 'existing.yml'
            protected_file.write_text('trusted: true\n')
            (root / 'server').mkdir()
            (root / 'server' / 'alias').symlink_to(protected, target_is_directory=True)
            artifact = root / 'candidate.json'
            artifact.write_text(json.dumps({'files': [{'path': 'server/alias/existing.yml', 'content': 'pwned: true\n'}]}))
            import os
            old = os.getcwd()
            try:
                os.chdir(root)
                with self.assertRaisesRegex(agent.AgentError, 'symbolic-link component'):
                    agent.apply_artifact(artifact)
            finally:
                os.chdir(old)
            self.assertEqual(protected_file.read_text(), 'trusted: true\n')

    def test_applies_validated_file_content(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            artifact = root / 'candidate.json'
            artifact.write_text(json.dumps({'files': [{'path': 'server/new.ts', 'content': 'export const ok = true;\n'}]}))
            import os
            old = os.getcwd()
            try:
                os.chdir(root)
                agent.apply_artifact(artifact)
            finally:
                os.chdir(old)
            self.assertEqual((root / 'server/new.ts').read_text(), 'export const ok = true;\n')

if __name__ == '__main__':
    unittest.main()
