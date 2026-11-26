import unittest
from unittest.mock import patch

from generate import (
    TtsError,
    content_hash,
    deduplicate_tasks,
    ensure_within_budget,
    merge_manifests,
    normalize_text,
    split_text,
    synthesize_piece,
)


VOICE = {
    "voiceName": "cmn-CN-Standard-A",
    "languageCode": "cmn-CN",
    "speakingRate": 1,
    "pitch": 0,
    "volumeGainDb": 0,
}


class TtsHelpersTests(unittest.TestCase):
    def test_normalize_text_preserves_line_breaks_and_normalizes_whitespace(self):
        self.assertEqual(normalize_text("  e\u0301   \r\n\t你好  "), "é\n你好")

    def test_content_hash_uses_text_and_voice_parameters(self):
        text_hash = content_hash("你好", VOICE)
        self.assertEqual(text_hash, content_hash("  你好  ", VOICE))
        changed_voice = {**VOICE, "speakingRate": 1.1}
        self.assertNotEqual(text_hash, content_hash("你好", changed_voice))

    def test_unsupported_pitch_does_not_affect_hash(self):
        first = {**VOICE, "pitchSupported": False, "pitch": -10}
        second = {**VOICE, "pitchSupported": False, "pitch": 10}
        self.assertEqual(content_hash("你好", first), content_hash("你好", second))
        self.assertNotEqual(content_hash("你好", first), content_hash("你好", VOICE))

    def test_unsupported_pitch_is_omitted_from_google_request(self):
        import base64

        payload = {}

        def fake_request(_api_key, request_payload):
            payload.update(request_payload)
            return {"audioContent": base64.b64encode(b"mp3").decode("ascii")}

        with patch("generate._google_request", side_effect=fake_request):
            audio = synthesize_piece(
                "你好",
                {**VOICE, "pitchSupported": False},
                "not-a-real-key",
            )

        self.assertEqual(audio, b"mp3")
        self.assertNotIn("pitch", payload["audioConfig"])

    def test_deduplicate_tasks_merges_roles_and_message_counts(self):
        digest = content_hash("你好", VOICE)
        task = {
            "hash": digest,
            "text": "你好",
            "voice": VOICE,
            "messageCount": 1,
            "roles": ["甲"],
            "channels": ["主频道"],
        }
        duplicate = {
            **task,
            "messageCount": 2,
            "roles": ["乙"],
            "channels": ["闲聊"],
        }
        results = deduplicate_tasks([task, duplicate])
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["messageCount"], 3)
        self.assertCountEqual(results[0]["roles"], ["甲", "乙"])
        self.assertEqual(results[0]["channels"], ["主频道", "闲聊"])

    def test_deduplicate_tasks_rejects_hash_mismatch(self):
        with self.assertRaises(TtsError):
            deduplicate_tasks([{
                "hash": "incorrect",
                "text": "你好",
                "voice": VOICE,
            }])

    def test_split_text_respects_utf8_byte_limit_and_preserves_text(self):
        text = "你好世界。" * 1800
        chunks = split_text(text, max_bytes=4500)
        self.assertGreater(len(chunks), 1)
        self.assertEqual("".join(chunks), normalize_text(text))
        self.assertTrue(all(len(chunk.encode("utf-8")) <= 4500 for chunk in chunks))

    def test_splits_short_but_overlong_sentence_at_chinese_commas(self):
        text = "甲" * 45 + "，" + "乙" * 45 + "，" + "丙" * 20
        chunks = split_text(text)
        self.assertGreater(len(chunks), 1)
        self.assertEqual("".join(chunks), text)
        self.assertTrue(all(len(chunk) <= 80 for chunk in chunks))

    def test_split_long_sentence_at_unicode_boundaries(self):
        text = "界" * 3000
        chunks = split_text(text, max_bytes=64)
        self.assertEqual("".join(chunks), text)
        self.assertTrue(all(len(chunk.encode("utf-8")) <= 64 for chunk in chunks))

    def test_budget_guard_blocks_over_budget_before_generation(self):
        with self.assertRaises(TtsError):
            ensure_within_budget(50, 10, 41, 100)
        ensure_within_budget(50, 10, 40, 100)

    def test_merge_manifest_preserves_entries_and_monthly_usage(self):
        merged = merge_manifests(
            {
                "entries": {
                    "a": {"hash": "a", "characterCount": 3, "generatedAt": "2026-11-02T00:00:00Z"}
                },
                "usage": {"2026-11": {"generatedCharacters": 3, "previewCharacters": 2}},
            },
            {
                "entries": {
                    "b": {"hash": "b", "characterCount": 4, "generatedAt": "2026-11-03T00:00:00Z"}
                },
                "usage": {"2026-11": {"generatedCharacters": 4, "previewCharacters": 1}},
            },
        )
        self.assertEqual(set(merged["entries"]), {"a", "b"})
        self.assertEqual(merged["usage"]["2026-11"]["generatedCharacters"], 7)
        self.assertEqual(merged["usage"]["2026-11"]["previewCharacters"], 2)
        self.assertEqual(merged["usage"]["2026-11"]["totalCharacters"], 9)


if __name__ == "__main__":
    unittest.main()
