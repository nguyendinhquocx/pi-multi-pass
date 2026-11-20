---
artifact_type: "completed-spec"
spec_id: "SPEC-2026-11-20-quan-ly-pool-ngay-trong-menu-account"
status: "archived"
title: "Quản lý Pool ngay trong menu account"
archived_at: "2026-11-20T11:38:38+07:00"
source_file: "SPEC-2026-11-19-account-menu-pool-membership.md"
source_sha256: "d060744a591b492138580aa4ff7828b2886c5cfd7c3bff20f3ab8412db7130f3"
implementation_ref: "4549b62fa4ceb47f73a3f10181ccdc90bea6005b"
working_tree: "dirty"
related_paths: ["extensions/multi-sub.ts", "lib/pool-membership.ts", "lib/virtual-pool.ts", "tests/account-pool-menu-check.mjs", "tests/pool-member-switch-check.mjs", "tests/subs-switch-check.mjs", "tests/pool-edit-check.mjs", "tests/virtual-pool-check.mjs", "tests/virtual-pool-provider-check.mjs", "README.md"]
---

# Spec: Quản lý Pool ngay trong menu account

## Context Snapshot
- Project / module: `pi-multi-pass`, extension TypeScript cho Pi.
- Stack / runtime: Pi extension API, `pi.registerProvider`, ModelRegistry, TUI qua `ctx.ui`.
- Current behavior: menu account `/subs` có rename/login/logout/remove; muốn thêm hoặc bỏ account khỏi Pool phải thoát sang `/pool list` → chọn Pool → `members` → chỉnh rồi lưu.
- Desired behavior: từ menu của account, add/move/remove Pool membership; `/model` chỉ hiện Virtual Pool Provider và account không thuộc Virtual Pool (member Routing Pool vẫn hiện riêng). Account đã nằm trong Pool vẫn phải chọn riêng được qua `/subs switch`.
- Relevant files: `extensions/multi-sub.ts` (`showSubscriptionActions`, `editPoolMembers`, `syncProviderCatalog`, `resolveSwitchTargetModel`), `lib/virtual-pool.ts`, `tests/pool-edit-check.mjs`, `tests/virtual-pool-provider-check.mjs`, `tests/subs-switch-check.mjs`.
- Existing constraints: Pool chỉ trộn account cùng `baseProvider`; account thuộc tối đa một Pool; không sửa OAuth credential hay tự phân account theo gói Free/Plus/Pro. `MULTI_SUB` env entries là read-only.

## Objective
- Cho phép quản lý Pool ngay tại account menu, áp dụng đồng nhất cho các saved subscription thuộc mọi provider multi-pass hỗ trợ.
- Giữ `/model` gọn: Pool là lựa chọn dùng chung; account trong Pool vẫn chọn trực tiếp được qua `/subs switch`.

## Scope
- In:
  - Thêm action `Pool membership` vào menu từng saved subscription.
  - Menu account liệt kê mọi Pool cùng provider gốc, phân biệt rõ `Virtual Provider` và `Routing Pool`; add/move/remove đều diễn ra tại đây.
  - Mỗi account thuộc tối đa một Pool tổng cộng. Chuyển Pool sẽ gỡ membership cũ và báo rõ; `No pool` bỏ membership khỏi mọi Pool cùng provider.
  - Nếu chưa có Pool cùng provider, cho tạo Pool mặc định `<baseProvider>-pool` ngay từ account menu; strategy mặc định `round-robin`.
  - `/model` hiển thị Virtual Pool Provider và account không thuộc Virtual Pool. Member của Routing Pool vẫn hiện riêng vì Routing Pool không tạo provider row; member Virtual Pool bị ẩn để tránh model row trùng.
  - `/subs switch` vẫn hiển thị member của Pool và phải thực sự chuyển được sang account đó dù catalog model con bị ẩn.
  - Pool mới từ account menu có tên `<baseProvider>-pool` và `asProvider: true`. Giữ nhận diện legacy `*-free`; tên `*-pool` một mình không đổi standard pool cũ thành Virtual Provider.
  - Đổi Pool hiện tại `openai-codex-free` thành `openai-codex-pool`, giữ nguyên members `openai-codex-3` và `openai-codex-5`; cập nhật reference trong cùng config nếu có.
- Out:
  - Pool membership cho credential built-in gốc như `openai-codex`/`anthropic`; chỉ áp dụng saved subscription entries `/subs` thêm.
  - Tự đoán Free/Plus/Pro rồi tự gán Pool; gói chỉ được biết sau login và owner muốn chủ động chọn.
  - Một account cùng lúc ở nhiều Pool.
  - Thay đổi OAuth, quota API, model contextWindow, hoặc cơ chế failover hiện tại.
  - Sửa project-specific Pool override; `/pool project` tiếp tục quản lý phần đó.

## UX Baseline
1. Keyboard: mũi tên đổi lựa chọn, Enter xác nhận/lưu, Esc quay lại mà không lưu thay đổi tạm.
2. Focus: lựa chọn hiện tại có prefix `→`/selected state, không dựa riêng vào màu.
3. Nhận diện: dùng email và nhãn account hiện có; trạng thái `đang ở Pool X` phải có chữ, không chỉ icon/màu.
4. Độ rộng: dùng `showWrappedSelect` hiện có; label ưu tiên email/account index để không mất khác biệt khi terminal hẹp.
5. States: unpooled / đang ở Virtual Pool / đang ở Routing Pool / conflict membership cũ / move / save / cancel / lỗi lưu.
6. Nhất quán: tái dùng `SelectItem`, `showWrappedSelect`, notification và `reloadPoolManagerForCurrentProject`; không dựng menu TUI riêng.
7. Platform: terminal Pi TUI; không áp viewport web/mobile.
8. Copy: action gọi thẳng `Pool membership`, `No pool`, tên Pool; không dùng giải thích nội bộ về `providerToPool`.

## Thuật ngữ
- Account member: provider ID của một subscription, ví dụ `openai-codex-5`.
- Pool membership: quan hệ một account với tối đa một Pool cùng provider gốc, virtual hoặc routing.
- Virtual Pool Provider: lựa chọn `/model` đại diện cho Pool, dùng auth từ member khả dụng và ẩn model catalog member.
- Routing Pool: Pool failover/chain không có provider entry riêng trong `/model`; member vẫn hiện riêng như account.
- Direct switch: đổi session sang provider ID của một account riêng qua `/subs switch`; không đồng nghĩa tắt Pool failover.

## Assumptions
- Account được chọn trực tiếp qua `/subs switch` trở thành member khởi đầu; nếu gặp rate limit, cơ chế failover Pool hiện tại vẫn chạy.
- Pool rỗng sau khi bỏ member cuối vẫn được giữ lại để tái sử dụng; Virtual Pool Provider không đăng ký khi không có member. Chain trỏ vào Pool rỗng sẽ báo không có member khả dụng.
- Membership action cập nhật global config như `/pool list`; project-specific override không bị sửa ngầm.

## Approach
- Dùng một helper duy nhất để cập nhật membership trong `/subs` account menu, `/pool list` → `members`, và `/pool create`; mọi đường ghi đều giữ invariant một account/một Pool.
- Account menu liệt kê mọi Pool cùng `baseProvider`, có nhãn `Virtual Provider`/`Routing Pool`, current membership, member count và emails. Chọn Pool mới sẽ move account; `No pool` gỡ membership; nếu account đang thuộc Pool khác, thông báo rõ Pool cũ bị rời.
- Member của Virtual Pool bị ẩn khỏi `/model`; member của Routing Pool vẫn hiện riêng. Nếu legacy config có membership trùng, cảnh báo và yêu cầu resolve qua menu, không tự sửa config khi startup.
- Khi bỏ member cuối, giữ Pool rỗng; Virtual Pool provider không đăng ký trong `/model` nhưng không prune chain references. Thêm member lại sẽ đăng ký provider trở lại.
- Với member của Virtual Pool, `registerSub` vẫn ẩn catalog con khỏi `/model`; member Routing Pool giữ model riêng. Khi `/subs switch` chọn member bị ẩn, dựng model từ catalog builtin + `models-store` của provider gốc, áp `modelOverrides` provider gốc rồi override riêng account; nhánh Minimax dùng `providerModelChoices`, OAuth `modifyModels` áp lên model member. Sau đó gọi `pi.setModel`; Pi chỉ check auth theo provider và ModelRuntime dispatch theo provider ID đã đăng ký.
- Pool mới từ account menu dùng tên `<baseProvider>-pool` và `asProvider: true`; `*-free` cũ vẫn được nhận diện. Không tự phân loại pool standard cũ chỉ vì tên kết thúc `-pool`.
- Khi rename pool, cập nhật cả chain `entry.pool` và preset `entry.provider` references trong cùng config.
- Nếu account đang active được thêm vào Virtual Pool, không tự đổi model; giữ member hiện tại và báo rõ phiên chỉ dùng pool khi owner chọn provider Pool.
- Không thêm hình thức UI mới: tham chiếu component TUI hiện có.

## Diagram

```mermaid
flowchart TD
    A[Chọn account trong /subs] --> B[Pool membership]
    B --> C{Pool cùng provider?}
    C -->|Có| D[Chọn Pool hoặc No pool]
    C -->|Không| E[Tạo provider-pool]
    D --> F[Chuyển khỏi Pool cũ nếu có]
    E --> G[Thêm account]
    F --> G
    G --> H[Lưu config + refresh catalog]
    H --> I[/model: Virtual Pool + account ngoài Virtual Pool]
    H --> J[/subs switch: mọi account]
```

## Task List

### Task 1: Pool naming, membership update rule, và catalog sync
- UX Contract:
  - Current: `/model` dùng pool tên `openai-codex-free`; member của Virtual Pool bị ẩn, member của Routing Pool vẫn hiện riêng.
  - Target: `/model` chỉ có Virtual Pool Provider và account không thuộc Virtual Pool; member của Routing Pool vẫn hiện riêng vì Routing Pool không tạo provider row.
  - State: Pool rỗng được giữ để tái dùng, nhưng không đăng ký thành lựa chọn model cho đến khi có member.
  - Keyboard/selection: giữ hành vi chọn model Pi hiện tại; không thêm control mới ở task này.
- Skills: `flow`, `ui-design`, `pi-build-extension`, `test`, `verify`.
- Visual Ref: `extensions/multi-sub.ts::syncProviderCatalog` và Pi `/model` catalog; không đổi style/UI component.
- Acceptance:
  - Pool mới từ account menu có tên `<baseProvider>-pool` + `asProvider: true`; `*-free` cũ vẫn nhận diện. Tên `*-pool` tự nó không đổi standard pool cũ thành virtual.
  - Tất cả mutation paths (`/subs` membership, `/pool list` members, `/pool create`) dùng chung rule one-pool-per-account. Legacy duplicate được phát hiện/báo rõ, không tự sửa config khi startup.
  - Virtual Pool members ẩn khỏi `/model`; Routing Pool members vẫn hiện riêng. Pool rỗng không đăng ký provider; chain references không bị prune.
  - Pool rename cập nhật chain `entry.pool` và preset `entry.provider` references; members và credential giữ nguyên.
- Reproduce: `cd "D:/pcloud/workspace/code/python/app_presets/pi/extensions/pi-multi-pass" && node tests/virtual-pool-check.mjs && node tests/pool-edit-check.mjs`
- Verify: regression cho `*-pool` vs legacy standard name `*-pool`, legacy `*-free`, duplicate/move/unpool qua mọi mutation path, empty-pool provider skip, chain/preset reference rename.
- Files:
  - `D:\pcloud\workspace\code\python\app_presets\pi\extensions\pi-multi-pass\lib\virtual-pool.ts` — pattern: `isVirtualPool` xử lý `asProvider` trước convention.
  - `D:\pcloud\workspace\code\python\app_presets\pi\extensions\pi-multi-pass\extensions\multi-sub.ts` — pattern: `syncProviderCatalog`, `editPoolMembers`, `promptForPoolDefinition`, `renamePoolConfig`, `reloadPoolManagerForCurrentProject`.
  - `D:\pcloud\workspace\code\python\app_presets\pi\extensions\pi-multi-pass\tests\virtual-pool-check.mjs`

### Task 2: Pool membership action trong menu account
- Acceptance:
  - Mọi saved subscription thuộc provider multi-pass hỗ trợ có action `Pool membership` trong account menu; built-in base account nằm ngoài v1.
  - Danh sách hiện mọi Pool cùng `baseProvider`, có nhãn type (`Virtual Provider` hoặc `Routing Pool`), member count, emails và auth state.
  - Một account chỉ thuộc tối đa một Pool; chọn Pool khác sẽ move khỏi Pool cũ, `No pool` gỡ membership. Nếu move khỏi Routing Pool sang Virtual Pool, notification phải nêu rõ Pool cũ bị rời.
  - Nếu chưa có Virtual Pool cùng provider, menu có lựa chọn tạo `<baseProvider>-pool` với `asProvider: true`, strategy `round-robin`, rồi thêm account.
  - Account trong Routing Pool vẫn có model riêng trong `/model`; account trong Virtual Pool bị ẩn, Virtual Pool Provider thay thế.
  - `MULTI_SUB` env entry vẫn read-only; không logout/login hoặc sửa auth khi đổi membership.
  - Action row hiển thị `Currently in <pool>` hoặc `No pool`; sau save/cancel quay về `/subs list`.
  - Save failure báo lỗi và không thay đổi persisted config.
- UX Contract:
  - Surface: Operate, terminal TUI.
  - Current: `/subs list` → chọn account → không có Pool action → Esc → `/pool list` → chọn Pool → `members` → add/remove → save.
  - Target: `/subs list` → account → `Pool membership` → chọn target cùng provider/`No pool` → save tại menu account.
  - Pool option phân biệt Virtual Provider và Routing Pool; hiện member count/emails. Action row báo current membership ngay, không bắt mở submenu chỉ để xem state.
  - States: unpooled / Virtual Provider Pool / Routing Pool / legacy conflict / move / không có target / save thành công / lỗi lưu; Esc hủy thay đổi tạm.
  - Keyboard: `showWrappedSelect`; Enter chọn, Esc quay lại; email/account index phải phân biệt khi terminal hẹp.
  - Sau save/cancel quay lại `/subs list`. Nếu account đang active được đưa vào Virtual Pool, session vẫn ở member hiện tại đến khi user chọn Pool; báo trạng thái này.
  - Move từ standard sang virtual làm account biến khỏi model catalog riêng; notification phải nêu rõ. Không confirm thừa nếu chỉ move một member và impact đã hiện trước khi chọn.
  - Không dựa riêng vào màu/icon; save lỗi phải nêu cách thử lại/khôi phục.
- Skills: `flow`, `ui-design`, `pi-build-extension`, `test`, `verify`.
- Visual Ref: `extensions/multi-sub.ts::showWrappedSelect`, `showSubscriptionActions`, `editPoolMembers`; không đổi visual world.
- Reproduce: `cd "D:/pcloud/workspace/code/python/app_presets/pi/extensions/pi-multi-pass" && node tests/account-pool-menu-check.mjs`
- Verify: TUI fixture kiểm Codex và một provider khác; no-pool → tạo default; add/move/unpool; move standard→virtual; auth state; cancel không ghi; save failure không làm thay đổi config persisted.
- Files:
  - `D:\pcloud\workspace\code\python\app_presets\pi\extensions\pi-multi-pass\extensions\multi-sub.ts` — pattern: `showSubscriptionActions` dùng `showWrappedSelect` và `SelectItem`.
  - `D:\pcloud\workspace\code\python\app_presets\pi\extensions\pi-multi-pass\tests\fixtures\account-pool-menu.ts` — pattern: `tests/fixtures/minimax-choices.ts` đăng ký command fixture và gọi extension production.

### Task 3: Direct switch của member đang bị ẩn trong `/model`
- UX Contract:
  - Surface: Operate, terminal TUI.
  - Current: `/subs switch` vẫn liệt kê account member nhưng resolver tìm model trong catalog rỗng; chọn xong có thể không chuyển được.
  - Target: cùng menu vẫn chọn member bằng email/index; Pi chuyển sang đúng provider account và giữ model ID hiện tại nếu account hỗ trợ model đó.
  - Recovery: nếu model ID không tồn tại trên member, chọn model fallback hợp lệ; thông báo rõ nếu không có model khả dụng.
  - Rate-limit: member được chọn là account bắt đầu; Pool failover hiện hữu vẫn chạy nếu request chạm limit.
- Skills: `flow`, `pi-build-extension`, `test`, `verify`.
- Visual Ref: `extensions/multi-sub.ts::handleSubsSwitch` và `showWrappedSelect`; giữ menu/keyboard behavior hiện có.
- Acceptance:
  - `/subs switch` vẫn liệt kê pooled member theo email/index.
  - Chọn member hidden thành công bằng model ID hiện tại nếu member có model đó; nếu không, dùng model hợp lệ đầu tiên của base provider.
  - Model construct lấy catalog builtin + `models-store` của base provider; áp context/model overrides theo thứ tự base → member.
  - Provider-specific `modifyModels`/OAuth transformations được áp trước `pi.setModel`; model chứa đủ `api`, `baseUrl` và `provider=<member ID>`.
  - `minimaxBase` tiếp tục dùng `providerModelChoices`; không bỏ model overlay-only.
  - Sau `modelRegistry.refresh()`, current model vẫn giữ ID/provider và member vẫn direct-switch được.
  - Pool failover sau rate limit không đổi.
- Reproduce: `cd "D:/pcloud/workspace/code/python/app_presets/pi/extensions/pi-multi-pass" && node tests/subs-switch-check.mjs && node tests/account-pool-menu-check.mjs`
- Verify: integration fixture dùng fake OAuth/auth, không gọi mạng; assert `pi.setModel` nhận model ID/provider đúng sau switch, model metadata/overrides và provider transform đúng, refresh không làm mất active model, child model vẫn vắng khỏi `/model`.
- Files:
  - `D:\pcloud\workspace\code\python\app_presets\pi\extensions\pi-multi-pass\extensions\multi-sub.ts` — pattern: `resolveSwitchTargetModel`, `findSelectableModelForProvider`, `cloneModels`, `liveSubscriptionModels`, `PoolManager.getActiveVirtualMember`.
  - `D:\pcloud\workspace\code\python\app_presets\pi\extensions\pi-multi-pass\tests\subs-switch-check.mjs` — pattern: preferred-model/fallback-model.
  - `D:\pcloud\workspace\code\python\app_presets\pi\extensions\pi-multi-pass\tests\fixtures\pool-member-switch.ts` — pattern: `tests/fixtures/codex-context-refresh.ts` for RPC registry/model assertions.

### Task 4: Đổi tên Pool hiện tại và cập nhật tài liệu
- Acceptance:
  - Global config đổi `openai-codex-free` → `openai-codex-pool`, giữ members `openai-codex-3`/`openai-codex-5` và cập nhật chain/preset references trong cùng config; Plus `openai-codex-2` vẫn unpooled.
  - README nói rõ Pool có thể trộn plan, account được chọn riêng bằng `/subs switch`, `/model` hiện Virtual Pool + account ngoài Virtual Pool (member Routing Pool vẫn hiện riêng).
- Reproduce: `cd "D:/pcloud/workspace/code/python/app_presets/pi/extensions/pi-multi-pass" && node tests/virtual-pool-provider-check.mjs`
- Verify: đọc lại config an toàn; `pi --list-models` thấy `openai-codex-pool`, pooled virtual members ẩn, Routing Pool members vẫn hiện, `openai-codex-2` còn riêng.
- Files:
  - `C:\Users\quocn\.pi\agent\multi-pass.json` — chỉ sửa tên Pool và giữ members/reference; không đọc/sửa `auth.json`.
  - `D:\pcloud\workspace\code\python\app_presets\pi\extensions\pi-multi-pass\README.md` — pattern: mục `Virtual Pool Provider and language`.

## Checkpoints
- Sau Task 1: convention + tests pass; chưa đổi live user config.
- Sau Task 2–3: menu add/move/remove và direct member switch fixture PASS.
- Final: config migration, TSC strict, toàn bộ `tests/*.mjs`, `git diff --check`, independent read-only review, `/model` catalog smoke.

## External Review Brief
### Reviewer cần phán
- Menu action có giữ one-pool-per-account và chỉ cho cùng provider không?
- Direct switching có thật sự chọn provider ID của pooled member khi models catalog của nó rỗng không?
- Pool visibility trong `/model` khớp lựa chọn “Virtual Pool + account ngoài Virtual Pool (member Routing Pool vẫn hiện riêng)” không?
- Rename/move/unpool có vô tình xóa auth, preset hoặc chain không?

### Reviewer nên đọc trước
- `extensions/multi-sub.ts`: `showSubscriptionActions`, `getSwitchableProviderOptions`, `resolveSwitchTargetModel`, `syncProviderCatalog`, `editPoolMembers`.
- `lib/virtual-pool.ts` và tests mới liên quan.
- Pi `ModelRegistry.find`, `AgentSession.setModel`, `ModelRuntime.streamSimple` docs/source đã nêu trong Context Snapshot.

### Reviewer không cần phán
- OAuth login implementation, quota parsing, contextWindow overrides, hoặc model quality; các phần đó không đổi.

## User Test
| Hành động | Kết quả kỳ vọng | Chuẩn nhìn |
|---|---|---|
| `/subs list` → chọn `openai-codex-5` → `Pool membership` → chọn `openai-codex-pool` | Account #5 vào Pool, không logout/login | Menu báo Pool hiện tại; status cập nhật sau save |
| Chọn account #5 → `Pool membership` → `No pool` | #5 rời Pool nhưng credential vẫn giữ | `/subs switch` còn #5; `/model` hiện #5 riêng sau khi unpooled |
| Thêm/move account #2 vào Pool | #2 rời Pool cũ (nếu có), không tạo membership chồng | Chỉ một Pool hiển thị cho #2; không đổi trạng thái Plus |
| `/subs switch` → chọn member đang trong Pool | Session chuyển đúng member và model ID | Footer/provider ghi đúng account; quota failover vẫn theo Pool |
| `/model` tìm `gpt-6-luna` | Hiện `openai-codex-pool` và account chưa có Pool; không lặp row cho từng member | Không tràn ngang; email của account riêng vẫn nhận ra |
| Provider chưa có Pool nào → `Pool membership` → chọn tạo Pool mặc định | Pool mới lưu `asProvider: true`, strategy `round-robin`, account vào Pool ngay | Menu báo tạo thành công; `/model` xuất hiện Virtual Pool Provider |
| Đổi membership khi config file không ghi được | Save thất bại, báo lỗi rõ ràng | Config persisted giữ nguyên; sửa xong nguyên nhân thì thử lại được |

5 câu Y/N:
1. Menu Pool membership có mở được và hiện đúng account/email không?
2. Enter chọn/move và Esc hủy có hoạt động đúng không?
3. Account pooled có chọn riêng thành công qua `/subs switch` không?
4. Sau khi bỏ khỏi Pool, account có xuất hiện riêng trong `/model` mà vẫn đăng nhập không?
5. `/model` có hiện Pool một lần, không lặp mỗi member không?

## Decided Defaults (was Open Questions)
- Bỏ member cuối: giữ Pool rỗng để tái sử dụng, không prune chain references (đã nằm trong Assumptions).
- Chọn trực tiếp member đang ở Pool: giữ hành vi cũ — account được chọn là điểm bắt đầu, rate limit vẫn xoay trong Pool, không pin cứng.

## Risks
- Provider member bị ẩn khỏi ModelRegistry catalog nên `/subs switch` phải tạo model hợp lệ riêng; sai API/header/model transform có thể làm account hiện trong selector nhưng request thất bại. Bắt buộc integration test không mạng.
- Pool rename phải giữ chain references trong cùng config; migration không chạm `auth.json`.
- `/subs switch` direct member vẫn đi qua Pool failover khi có rate limit; không phải hard pin.

## Completion Gates
- [ ] TSC strict + regressions + full tests pass.
- [ ] `git diff --check` sạch; diff chỉ thuộc files trong Scope.
- [ ] Independent read-only review không còn blocker.
- [ ] Offline TUI/model-catalog smoke pass.
- [ ] Owner UAT checklist pass trước khi report DONE cho menu flow.
