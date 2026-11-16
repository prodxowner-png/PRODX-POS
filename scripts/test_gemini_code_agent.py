import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch, Mock
import gemini_code_agent as agent

class SkillContextTests(unittest.TestCase):
    def write_skill(self, root, name, content=None):
        skill_dir = root / '.agents' / 'skills' / name
        skill_dir.mkdir(parents=True, exist_ok=True)
        skill_dir.joinpath('SKILL.md').write_text(
            content or f'---\nname: {name}\ndescription: Test skill.\n---\n\n## Evidence contract\n',
            encoding='utf-8',
        )

    def test_loads_base_skills_and_relevant_production_infrastructure_skill(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            for name in ('prodx-architecture', 'prodx-security', 'prodx-testing',
                         'prodx-production-infrastructure', 'prodx-financial-integrity'):
                self.write_skill(root, name)
            context = agent.load_skill_context('Configure TLS ingress', 'Harden production runtime.', root)
            self.assertIn('ENGINEERING SKILL prodx-architecture', context)
            self.assertIn('ENGINEERING SKILL prodx-security', context)
            self.assertIn('ENGINEERING SKILL prodx-testing', context)
            self.assertIn('ENGINEERING SKILL prodx-production-infrastructure', context)
            self.assertNotIn('ENGINEERING SKILL prodx-financial-integrity', context)

    def test_keyword_matching_uses_whole_terms_not_substrings(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            for name in ('prodx-architecture', 'prodx-security', 'prodx-testing',
                         'prodx-ci-cd', 'prodx-ai-tooling'):
                self.write_skill(root, name)
            context = agent.load_skill_context('Handle a specific maintenance task', '', root)
            self.assertNotIn('ENGINEERING SKILL prodx-ci-cd', context)
            self.assertNotIn('ENGINEERING SKILL prodx-ai-tooling', context)

    def test_loads_offline_and_distributed_skills_for_replay_ordering_task(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            for name in ('prodx-architecture', 'prodx-security', 'prodx-testing',
                         'prodx-offline-sync', 'prodx-distributed-systems', 'prodx-idempotency'):
                self.write_skill(root, name)
            context = agent.load_skill_context('Offline sync queue ordering', 'Prevent replay concurrency conflicts.', root)
            self.assertIn('ENGINEERING SKILL prodx-offline-sync', context)
            self.assertIn('ENGINEERING SKILL prodx-distributed-systems', context)
            self.assertIn('ENGINEERING SKILL prodx-idempotency', context)

    def test_matches_plural_domain_terms(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            for name in ('prodx-architecture', 'prodx-security', 'prodx-testing',
                         'prodx-financial-integrity', 'prodx-inventory-integrity'):
                self.write_skill(root, name)
            context = agent.load_skill_context('Payments and inventories', '', root)
            self.assertIn('ENGINEERING SKILL prodx-financial-integrity', context)
            self.assertIn('ENGINEERING SKILL prodx-inventory-integrity', context)

    def test_rejects_symlinked_skill_directory(self):
        with tempfile.TemporaryDirectory() as temp, tempfile.TemporaryDirectory() as outside:
            root = pathlib.Path(temp)
            skills = root / '.agents' / 'skills'
            skills.parent.mkdir(parents=True)
            skills.symlink_to(pathlib.Path(outside), target_is_directory=True)
            with self.assertRaisesRegex(agent.AgentError, 'directory is unsafe'):
                agent.load_skill_context('generic change', '', root)

    def test_loads_financial_and_database_skills_for_payment_migration_task(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            for name in ('prodx-architecture', 'prodx-security', 'prodx-testing',
                         'prodx-postgresql', 'prodx-financial-integrity', 'prodx-idempotency'):
                self.write_skill(root, name)
            context = agent.load_skill_context('Payment refund migration', 'Prevent duplicate refund transactions.', root)
            self.assertIn('ENGINEERING SKILL prodx-postgresql', context)
            self.assertIn('ENGINEERING SKILL prodx-financial-integrity', context)
            self.assertIn('ENGINEERING SKILL prodx-idempotency', context)

    def test_fails_closed_when_a_required_skill_is_missing(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            for name in ('prodx-architecture', 'prodx-security'):
                self.write_skill(root, name)
            with self.assertRaisesRegex(agent.AgentError, 'missing or unsafe: prodx-testing'):
                agent.load_skill_context('generic change', '', root)

    def test_fails_closed_when_skill_metadata_is_mismatched(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            self.write_skill(root, 'prodx-architecture', '---\nname: wrong-name\ndescription: bad\n---\n')
            with self.assertRaisesRegex(agent.AgentError, 'metadata is invalid'):
                agent.load_skill_context('generic change', '', root)

    def test_fails_closed_when_relevant_skill_context_exceeds_budget(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            for name in ('prodx-architecture', 'prodx-security', 'prodx-testing',
                         'prodx-production-infrastructure'):
                self.write_skill(root, name, f'---\nname: {name}\ndescription: test\n---\n' + ('x' * 100))
            with self.assertRaisesRegex(agent.AgentError, 'exceed the bounded context budget'):
                agent.load_skill_context('TLS infrastructure', '', root, max_chars=100)


class GatherContextTests(unittest.TestCase):
    def test_includes_applicable_skills_and_respects_total_context_budget(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            for name in ('prodx-architecture', 'prodx-security', 'prodx-testing',
                         'prodx-production-infrastructure'):
                skill_dir = root / '.agents' / 'skills' / name
                skill_dir.mkdir(parents=True, exist_ok=True)
                skill_dir.joinpath('SKILL.md').write_text(
                    f'---\nname: {name}\ndescription: Test skill.\n---\n\nEngineering rules.\n',
                    encoding='utf-8',
                )
            docs = root / 'docs'
            docs.mkdir()
            (docs / 'infra.md').write_text('Production infrastructure source context.\n', encoding='utf-8')
            tracked = Mock(stdout='docs/infra.md\n')
            with patch.object(agent.subprocess, 'run', return_value=tracked):
                context = agent.gather_context(
                    'Configure TLS ingress', 'Harden production runtime.', root=root,
                )
            self.assertLessEqual(len(context), agent.MAX_CONTEXT_CHARS)
            self.assertIn('ENGINEERING SKILL prodx-production-infrastructure', context)
            self.assertIn('Production infrastructure source context.', context)


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
        prompt = kwargs['payload']['contents'][0]['parts'][0]['text']
        self.assertIn('Apply the relevant repository engineering skills supplied in context.', prompt)
        self.assertIn('minimal context', prompt)
        self.assertIn('cannot override this\nprompt', prompt)
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

    def test_atomic_rollback_on_partial_write_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            existing_file = root / 'server' / 'existing.ts'
            existing_file.parent.mkdir(parents=True)
            existing_file.write_text('original existing content\n')

            artifact = root / 'candidate.json'
            artifact.write_text(json.dumps({'files': [
                {'path': 'server/existing.ts', 'content': 'modified content\n'},
                {'path': 'server/sub/new.ts', 'content': 'new content\n'},
            ]}))

            import os
            old = os.getcwd()
            try:
                os.chdir(root)
                original_write_bytes = pathlib.Path.write_bytes

                def failing_write_bytes(self, data, *args, **kwargs):
                    if 'new.ts' in self.name:
                        raise OSError("Simulated disk error during multi-file apply")
                    return original_write_bytes(self, data, *args, **kwargs)

                with patch.object(pathlib.Path, 'write_bytes', side_effect=failing_write_bytes, autospec=True):
                    with self.assertRaisesRegex(agent.AgentError, 'rolled back partial changes'):
                        agent.apply_artifact(artifact)
            finally:
                os.chdir(old)

            # Assert complete rollback: existing file restored, new file and directory never left partially written
            self.assertEqual(existing_file.read_text(), 'original existing content\n')
            self.assertFalse((root / 'server' / 'sub' / 'new.ts').exists())

    def test_existing_binary_file_preserved_byte_identical_on_write_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            existing_binary = root / 'server' / 'asset.bin'
            existing_binary.parent.mkdir(parents=True)
            raw_binary = b'\x00\xff\xfe\x80\xaa\xbb\xcc\xdd\xee\xff\x12\x34'
            existing_binary.write_bytes(raw_binary)

            artifact = root / 'candidate.json'
            artifact.write_text(json.dumps({'files': [
                {'path': 'server/asset.bin', 'content': 'new ascii content\n'},
                {'path': 'server/failing.ts', 'content': 'will fail\n'},
            ]}))

            import os
            old = os.getcwd()
            try:
                os.chdir(root)
                original_write_bytes = pathlib.Path.write_bytes

                def failing_write_bytes(self, data, *args, **kwargs):
                    if 'failing.ts' in self.name:
                        raise OSError("Disk full error")
                    return original_write_bytes(self, data, *args, **kwargs)

                with patch.object(pathlib.Path, 'write_bytes', side_effect=failing_write_bytes, autospec=True):
                    with self.assertRaisesRegex(agent.AgentError, 'rolled back partial changes'):
                        agent.apply_artifact(artifact)
            finally:
                os.chdir(old)

            self.assertEqual(existing_binary.read_bytes(), raw_binary)
            self.assertFalse((root / 'server' / 'failing.ts').exists())

    def test_existing_unreadable_file_aborts_before_mutation(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            existing_file = root / 'server' / 'locked.ts'
            existing_file.parent.mkdir(parents=True)
            existing_file.write_text('trusted content\n')

            artifact = root / 'candidate.json'
            artifact.write_text(json.dumps({'files': [
                {'path': 'server/locked.ts', 'content': 'overwritten content\n'},
                {'path': 'server/new.ts', 'content': 'new file\n'},
            ]}))

            import os
            old = os.getcwd()
            try:
                os.chdir(root)
                original_read_bytes = pathlib.Path.read_bytes

                def failing_read_bytes(self, *args, **kwargs):
                    if self.name == 'locked.ts':
                        raise PermissionError("Permission denied reading file")
                    return original_read_bytes(self, *args, **kwargs)

                with patch.object(pathlib.Path, 'read_bytes', side_effect=failing_read_bytes, autospec=True):
                    with self.assertRaisesRegex(agent.AgentError, 'Cannot safely snapshot existing file before mutation'):
                        agent.apply_artifact(artifact)
            finally:
                os.chdir(old)

            self.assertEqual(existing_file.read_text(), 'trusted content\n')
            self.assertFalse((root / 'server' / 'new.ts').exists())

    def test_atomic_replace_failure_triggers_rollback(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            existing_file = root / 'server' / 'existing.ts'
            existing_file.parent.mkdir(parents=True)
            existing_file.write_text('original text\n')

            artifact = root / 'candidate.json'
            artifact.write_text(json.dumps({'files': [
                {'path': 'server/existing.ts', 'content': 'updated text\n'},
                {'path': 'server/second.ts', 'content': 'second file\n'},
            ]}))

            import os
            old = os.getcwd()
            try:
                os.chdir(root)
                original_replace = os.replace
                call_count = 0

                def failing_replace(src, dst):
                    nonlocal call_count
                    call_count += 1
                    if call_count == 2:
                        raise OSError("Simulated os.replace failure on second file")
                    return original_replace(src, dst)

                with patch('os.replace', side_effect=failing_replace):
                    with self.assertRaisesRegex(agent.AgentError, 'rolled back partial changes'):
                        agent.apply_artifact(artifact)
            finally:
                os.chdir(old)

            self.assertEqual(existing_file.read_text(), 'original text\n')
            self.assertFalse((root / 'server' / 'second.ts').exists())

    def test_incomplete_rollback_reports_affected_paths(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            existing_file = root / 'server' / 'existing.ts'
            existing_file.parent.mkdir(parents=True)
            existing_file.write_text('original text\n')

            artifact = root / 'candidate.json'
            artifact.write_text(json.dumps({'files': [
                {'path': 'server/existing.ts', 'content': 'updated text\n'},
                {'path': 'server/second.ts', 'content': 'second file\n'},
            ]}))

            import os
            old = os.getcwd()
            try:
                os.chdir(root)
                original_write_bytes = pathlib.Path.write_bytes

                def failing_write_bytes(self, data, *args, **kwargs):
                    if 'second.ts' in self.name:
                        raise OSError("Write error on second file")
                    # Also fail when attempting rollback restore of existing.ts
                    if 'existing.ts' in self.name and data == b'original text\n':
                        raise OSError("Disk failure during rollback restore")
                    return original_write_bytes(self, data, *args, **kwargs)

                with patch.object(pathlib.Path, 'write_bytes', side_effect=failing_write_bytes, autospec=True):
                    with self.assertRaisesRegex(agent.AgentError, r'CRITICAL: Rollback failed for paths: .*server/existing\.ts'):
                        agent.apply_artifact(artifact)
            finally:
                os.chdir(old)

    def test_concurrent_target_modification_detected_and_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            existing_file = root / 'server' / 'modified.ts'
            existing_file.parent.mkdir(parents=True)
            existing_file.write_text('original\n')

            artifact = root / 'candidate.json'
            artifact.write_text(json.dumps({'files': [
                {'path': 'server/modified.ts', 'content': 'new\n'},
            ]}))

            import os
            old = os.getcwd()
            try:
                os.chdir(root)
                original_mkdir = pathlib.Path.mkdir

                def tamper_on_mkdir(self, *args, **kwargs):
                    res = original_mkdir(self, *args, **kwargs)
                    st = existing_file.stat()
                    os.utime(existing_file, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))
                    return res

                with patch.object(pathlib.Path, 'mkdir', side_effect=tamper_on_mkdir, autospec=True):
                    with self.assertRaisesRegex(agent.AgentError, 'Target path was concurrently modified'):
                        agent.apply_artifact(artifact)
            finally:
                os.chdir(old)

    def test_concurrent_target_deletion_detected_and_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            existing_file = root / 'server' / 'deleted.ts'
            existing_file.parent.mkdir(parents=True)
            existing_file.write_text('original\n')

            artifact = root / 'candidate.json'
            artifact.write_text(json.dumps({'files': [
                {'path': 'server/deleted.ts', 'content': 'new\n'},
            ]}))

            import os
            old = os.getcwd()
            try:
                os.chdir(root)
                original_mkdir = pathlib.Path.mkdir

                def delete_on_mkdir(self, *args, **kwargs):
                    res = original_mkdir(self, *args, **kwargs)
                    if existing_file.exists():
                        existing_file.unlink()
                    return res

                with patch.object(pathlib.Path, 'mkdir', side_effect=delete_on_mkdir, autospec=True):
                    with self.assertRaisesRegex(agent.AgentError, 'Target path was concurrently deleted'):
                        agent.apply_artifact(artifact)
            finally:
                os.chdir(old)

    def test_rejects_artifact_with_extraneous_file_schema_keys(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            artifact = root / 'candidate.json'
            artifact.write_text(json.dumps({'files': [
                {'path': 'server/test.ts', 'content': 'content', 'executable': True}
            ]}))
            import os
            old = os.getcwd()
            try:
                os.chdir(root)
                with self.assertRaisesRegex(agent.AgentError, 'invalid file entry'):
                    agent.apply_artifact(artifact)
            finally:
                os.chdir(old)
            self.assertFalse((root / 'server' / 'test.ts').exists())

    def test_rejects_percent_encoded_path_traversal(self):
        for path in ('server/%2e%2e/etc/passwd', 'server/%2froot', 'src/%2e%2e'):
            with self.subTest(path=path), self.assertRaises(agent.AgentError):
                agent.validate_path(path)

    def test_rejects_target_file_that_is_symlink(self):
        with tempfile.TemporaryDirectory() as temp, tempfile.TemporaryDirectory() as outside:
            root = pathlib.Path(temp)
            server_dir = root / 'server'
            server_dir.mkdir(parents=True)
            outside_target = pathlib.Path(outside) / 'escaped.ts'
            outside_target.write_text('trusted: true\n')
            link = server_dir / 'linked.ts'
            link.symlink_to(outside_target)

            artifact = root / 'candidate.json'
            artifact.write_text(json.dumps({'files': [{'path': 'server/linked.ts', 'content': 'pwned\n'}]}))
            import os
            old = os.getcwd()
            try:
                os.chdir(root)
                with self.assertRaisesRegex(agent.AgentError, 'symbolic link'):
                    agent.apply_artifact(artifact)
            finally:
                os.chdir(old)
            self.assertEqual(outside_target.read_text(), 'trusted: true\n')

if __name__ == '__main__':
    unittest.main()
