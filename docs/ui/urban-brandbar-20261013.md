# Urban BrandBar và tăng tương phản — 13/10/2026

## Khám phá trước sửa
Header: components/common/Navbar.jsx. Hero và ba CTA thật: pages/api/ApiScreens.jsx, ApiHomePage. Public shell: layouts/GuestLayout.jsx. Theme Tailwind4/global/Urban: index.css; không có Tailwind config riêng. Nền cũ #E4E0D8, card #EEEBE4, cam chính #FF7E33, hover #E86B23, chữ hero #A24B1E. Font Segoe UI/system sans, card24px, nút pill999px, hero ảnh120/28px giữ.

GET /vehicles trả brandId; GET /vehicles/catalog trả id/name hãng. ApiVehicleListPage đã có search/status/category/seats/transmission/sort clientside, chưa đọc brand URL. Hai API này đã được page tải: BrandBar nhận props và không fetch thêm. Dùng toàn bộ raw vehicles để tính hãng, không dùng sáu featured cars hay kết quả đang lọc. Tất cả trạng thái xe được tính theo dữ liệu danh sách hiện tại.

## File và hành vi cuối
| File | Thay đổi |
| --- | --- |
| frontend/src/components/vehicle/BrandBar.jsx (NEW) | Nav52px sau header, top7/more, dropdown link/aria-current/aria-expanded, Escape/focus/outside click, mobile hscroll. Không logo hãng. |
| frontend/src/utils/vehicleBrands.js (NEW) | Count theo brandId, chỉ hãng có xe, giảm dần số lượng rồi tên vi/ID để tie ổn định; lấy tên catalog, không hardcode hãng. |
| frontend/src/utils/vehicleBrands.test.js (NEW) | 6unit/mounted cases count/top7/more/empty/error/exactquery/history/compose/unknown/no extra fetch. |
| frontend/src/pages/api/ApiScreens.jsx | Gắn BrandBar vào ApiHomePage và ApiVehicleListPage; brand URL kết hợp filter cũ. Class urban-home giảm padding trước hero để bar thay khoảng trống. Không sửa chữ/ảnh/cấu trúc hero hoặc nghiệp vụ. |
| frontend/src/index.css | Token root một nơi, nền/card/header/hero CTA/BrandBar trạng thái. Không thêm font/library, giữ radius. |
| scripts/coordination/urban-brandbar/run-browser.py (NEW) | Tái dùng runner A4 source nguyên vẹn, exactfixture/JAR/backend input guards, API build và ownedcleanup. |
| scripts/coordination/urban-brandbar/verify-browser.cjs (NEW) | API fixture brands/vehicles/images; browser desktop/mobile, contrast/focus/filter/backforward/button states/screenshots. |
| scripts/coordination/urban-brandbar/README.md (NEW) | Rerun/ports/fixture/source/evidence và giới hạn. |
| docs/ui/urban-brandbar-20261013.md (NEW), docs/architecture/core-audit-20261007.md | Contract/token/assumptions/proof và audit giữ lịch sử. |

## Token và lý do
Mọi màu mới/shadow ở :root index.css, không inline màu trong component.
| Token/phần | Giá trị cuối |
| --- | --- |
| Page background | #F3EFE8, sáng hơn be cũ nhưng không nền trắng toàn trang |
| Surface/border | #FFFFFF / #E3DCD0; shadow0 1px 2px rgba(0,0,0,.04) |
| Brand bar/text | #963600 / #FFFFFF; height52px; hover trắng15%, selected trắng22%, underline trắng3px; focus trắng2px |
| Primary/hover/text accent | #FF7E33 / #E86B23 / #A24B1E (giữ cam/chữ hero); header hover/current dùng cam nâu text, underline cam2px và weight700 |
| Hero secondary | White, border1.5px #BFB3A3; shadow0 1px 2px black.08; hover bordercam/shadow0 3px 8px black.12; active translateY1px/shadow0 1px 1px black.06 |
| Hero primary | Shadow0 4px 12px rgba(255,127,50,.35); hover darker/translateY-1px; active translateY0/shadow0 2px 5px rgba(255,127,50,.2) |
| Transitions | Hero CTA150ms; reduced-motion rule hiện có giữ |

#C2500F + chữ trắng thường4.72:1, nhưng hover15% chỉ3.71:1, selected22% chỉ3.30:1. Điều chỉnh cùng gam sang #963600 để thường7.44:1, hover5.36:1, selected4.57:1, tất cả≥4.5. CSS border khai báo chính xác1.5px; Chromium computed width làm tròn1px, test kiểm riêng compiled shorthand1.5px và computed1px, không đổi spec hoặc che lỗi.

## Giả định
brand query dùng ID hãng ổn định, đã là slug toyota/hyundai/mitsubishi ở dữ liệu hiện có; hãng tạo mới dùng UUID (slug URL hợp lệ), được encodeURIComponent. Không tạo slug từ tên có thể đổi hoặc gây collision. Tất cả xe bỏ query brand; filter khác đang chọn được giữ. Brand không tồn tại cho zero results, không giả all. Thiếu brandId/error thì bar chỉ có Tất cả xe; dữ liệu project hiện có trường hãng nên không cần migration. Tên không resolve catalog dùng ID như fallback hiện tại.

BrandBar dành cho luồng API thật; demo vẫn nguồn riêng, không trộn GET thật vào demo. User yêu cầu mobile390 cho lượt này thay quy định desktop-only trước đó. Không đổi luật giá/quote/booking/roles/DB, không thêm thư viện.

## QA
Source cuối: 105/105 frontend tests zero skip, lint/demo build; API build của browser-final exit0. BrowserChromium thật38assertions, viewport1280/1440/390: real API brand counts/top7/unused excluded, More filter, aria/whitefocus/Escape, backforward/compose/all, hover/active/shadows, nooverflow, hscroll/hidden scrollbar, all contrast≥4.5,0runtime/consoleerrors. Screenshot clean stock3cars trước fixtureextra và fixture12brands/13vehicles để kiểm dropdown, chỉ ghi schema riêng trong exactA4fixture đãPASS; originalDB không testghi. Browser plugin/skill browser không có trong phiên nên Playwright fallback; chưa kiểm Safari/Firefox, không pending mandatory gate.

Không chạy lại backend khi source/dependency không đổi: giữ A4 16MySQL/123JARentry và clean verify135executed14SKIP (skip không PASS), đối chiếu input/JARhash. Owned Java/Node/Chromium dừng, fixture stopped/volumeKEEP, originalMySQL giữ chạy. Không push. TASK/HANDOFF/ACCEPTANCE/evidence: .runtime/coordination-urban-brandbar-20261013/.
