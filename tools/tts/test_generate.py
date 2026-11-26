import http.client
import json
import unittest
from unittest.mock import MagicMock, patch

from generate import (
    TtsError,
    _google_request,
    content_hash,
    deduplicate_tasks,
    ensure_within_budget,
    merge_manifests,
    normalize_text,
    split_text,
    synthesize_piece,
    synthesize_piece_with_fallback,
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

    def test_retries_google_long_sentence_errors_with_smaller_pieces(self):
        text = "我在厨房里" * 14
        requests = []

        def fake_synthesize(piece, _voice, _api_key):
            requests.append(piece)
            if len(piece) > 20:
                raise TtsError(
                    "Google TTS 返回 HTTP 400：This request contains sentences that are too long."
                )
            return piece.encode("utf-8")

        with patch("generate.synthesize_piece", side_effect=fake_synthesize):
            audio_pieces = synthesize_piece_with_fallback(text, VOICE, "not-a-real-key")

        self.assertGreater(len(audio_pieces), 1)
        self.assertEqual(b"".join(audio_pieces), text.encode("utf-8"))
        self.assertGreater(len(requests), len(audio_pieces))

    def test_does_not_retry_other_google_errors(self):
        error = TtsError("Google TTS 返回 HTTP 400：invalid voice")
        with patch("generate.synthesize_piece", side_effect=error) as synthesize:
            with self.assertRaisesRegex(TtsError, "invalid voice"):
                synthesize_piece_with_fallback("你好", VOICE, "not-a-real-key")
        synthesize.assert_called_once()

    def test_google_request_retries_incomplete_response_body(self):
        incomplete_response = MagicMock()
        incomplete_response.__enter__.return_value = incomplete_response
        incomplete_response.__exit__.return_value = None
        incomplete_response.read.side_effect = http.client.IncompleteRead(b"partial", 5)

        complete_response = MagicMock()
        complete_response.__enter__.return_value = complete_response
        complete_response.__exit__.return_value = None
        complete_response.read.return_value = json.dumps({"audioContent": "ok"}).encode()

        with patch(
            "generate.urllib.request.urlopen",
            side_effect=[incomplete_response, complete_response],
        ) as urlopen:
            with patch("generate.time.sleep") as sleep:
                result = _google_request("not-a-real-key", {"input": {"text": "你好"}})

        self.assertEqual(result, {"audioContent": "ok"})
        self.assertEqual(urlopen.call_count, 2)
        sleep.assert_called_once_with(1)

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
