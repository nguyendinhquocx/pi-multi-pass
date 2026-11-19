import assert from "node:assert/strict";
import { setMultiPassLanguage, translateUiText, translateUiValue } from "../lib/i18n.ts";

setMultiPassLanguage(undefined);
assert.equal(translateUiText("Subscription Manager"), "Quản lý tài khoản đăng ký");
assert.equal(translateUiText('Pool "free" is now enabled'), 'Pool "free" hiện đã bật.');
assert.equal(translateUiText("Language switched to English."), "Language switched to English.");

const option = { value: "openai-codex-2", label: "No pools configured." };
assert.deepEqual(translateUiValue(option), {
  value: "openai-codex-2",
  label: "Chưa cấu hình Pool.",
});

setMultiPassLanguage("en");
assert.equal(translateUiText("Subscription Manager"), "Subscription Manager");
assert.deepEqual(translateUiValue(option), option);

setMultiPassLanguage("vi");
assert.equal(translateUiText("Virtual Pool Provider for \"free\" is now enabled."), "Virtual Pool Provider cho \"free\" đã bật.");
console.log("i18n checks passed");
