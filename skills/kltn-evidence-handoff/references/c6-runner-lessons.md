# Căn cứ bổ sung sau giải trình C6 — 10/10/2026

Dùng khi tiếp nối runner/harness/provenance KLTN. Không là biên bản PASS và không yêu cầu đọc toàn lịch sử. Đường dẫn dưới đây tính từ repository root; chỉ đọc finding/source cần thiết.

| Bài học | Bằng chứng quyết định |
|---|---|
| Caller fixture không thay được snapshot gốc | .runtime/coordination-c6-opencode-20261010-133631/ACCEPTANCE.md: actual 4 ca caller mất env; test-caller-env-probe-fixed.ps1:72-73 ghi đè snapshot bằng fixture |
| Dependency đã PASS phải chọn đúng path/hash | .runtime/coordination-c6-antigravity-provenance-20261010-145933/ACCEPTANCE.md: probe/wrapper cũ được copy trở lại gây regression; OCF01/OCF02 ở lượt opencode-followup đã PASS scoped |
| Wrapper phải bảo vệ root riêng, guard runner con chưa đủ | .runtime/coordination-c6-evidence-fix-20261010-131316/ACCEPTANCE.md: wrapper ghi đè summary synthetic có sẵn; lượt opencode/ACCEPTANCE.md: pwsh wrapper tạo root trước khi runner con từ chối |
| Match cause literal, không wildcard bracket | .runtime/coordination-c6-antigravity-provenance-20261010-145933/test-provenance-guard-adverse.ps1:71,94; reviewer actual guard dùng literal cause để bù bằng chứng |
| Actual dependency manifest và hash drift | .runtime/coordination-c6-opencode-20261010-133631/ACCEPTANCE.md: bốn tests copy đang chạy không có trong manifest; followup/ACCEPTANCE.md: cuối mới chụp hash không chứng minh before/after |
| Process readback đúng identity | .runtime/coordination-c6-codexa-fix-20261010-152728/test-owned-cleanup.ps1: giữ process object, WaitForExit(5000), đọc HasExited sau finally; hai run lưu owned-process-readback.json |
| Source test và docs sau audit có thể khác hash hợp lệ | .runtime/coordination-c6-codexa-fix-20261010-152728/IMPLEMENTATION.md, reviewer-evidence/source-final-check.csv và docs-after-review-hashes.csv |

## Những nhận định trong giải trình chưa được dùng làm quy tắc

Nguồn: .runtime/coordination-c6-codexa-fix-20261010-152728/ANTIGRAVITY_EXPLANATION.md. Đây là giải trình cần đối chiếu, không tự chứng minh nguyên nhân.

- Nhận định “sửa docs làm lệch 4 hash” không đủ giải thích hash script cũng lệch. Biên bản integrate ghi ba script + UI doc lệch; chỉ xác nhận khác hash, không suy ai sửa hoặc vì sao.
- Nhận định tiêu chí refusal được reviewer thêm sau khi bỏ Remove-Item cần đối chiếu TASK: task evidence-20261010-acceptance đã yêu cầu reuse refuse trước mutation và giữ run đầu; task evidence-fix đã yêu cầu wrapper refuse root trước mutation. Có cụ thể hóa ca kiểm tra, không có căn cứ coi overwrite được chấp nhận trước đó.
- OCF02 wrapper được kiểm có thiếu shell guard; không mặc định có guard nhưng đặt sai thứ tự. Skill yêu cầu guard entrypoint trước mutation để bao cả hai tình huống.
- “Tuyệt đối không copy” và “snapshot ngay dòng đầu” là quá rộng. Copy có hash/import chứng minh và kiểm tra tác động được phép; snapshot phải trước write, không cản đọc source/precondition.
- Không có bằng chứng password thật bị mất trong các harness reviewer: giá trị caller dùng synthetic, chỉ lưu boolean. Không lặp lại giải trình như thể đã có sự cố secrets thật.
- Không dùng `(Get-Process -Id pid).HasExited` làm công thức duy nhất: process đã thoát có thể không còn object; PID cũng có thể tái sử dụng. Dùng identity đã giữ và readback phù hợp, không dừng process khác để tạo kết quả đẹp.

Không rút kết luận về năng lực/model/tâm lý hoặc đảm bảo không tái diễn. Kiểm tra từng scope bằng assertions thật; hướng dẫn mới giúp chọn đúng hành động, không thay nghiệm thu độc lập.
