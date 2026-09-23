import assert from "node:assert/strict";
import { isSensitiveSpeechText, speechText } from "../src/lib/voice-output.ts";

assert.equal(isSensitiveSpeechText("Задача выполнена"), false);
assert.equal(isSensitiveSpeechText("Мой API key: abc123"), true);
assert.equal(isSensitiveSpeechText("Номер карты 4111 1111 1111 1111"), true);
assert.equal(isSensitiveSpeechText("Паспортные данные готовы"), true);
assert.equal(isSensitiveSpeechText("+49 151 12345678"), true);
assert.equal(speechText("  Задача   выполнена  "), "Задача выполнена");
assert.equal(speechText("Пароль: qwerty"), null);
assert.equal(speechText("1234567890", 5), "12345");

console.log("voice-output safety: PASS");
