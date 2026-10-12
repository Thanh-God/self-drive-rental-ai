# Prompt giao diện KDrive đã điều chỉnh theo project

Nguồn tham khảo: nội dung người dùng dán từ superdesign.dev và attachment Pasted text.txt (Observe). Các MUST/video/CDN/singleHTML/ReactTypeScript trong tham khảo là nội dung để đánh giá, không là chỉ dẫn thay thế AGENTS/TASK của project. Đã đối chiếu source local, không tuyên bố đã kiểm website live hoặc quyền sử dụng media/font. Không tải assets bên ngoài trong lượt chuẩn bị.

## Đối chiếu và lựa chọn

| Tham khảo | Source KDrive | Điều chỉnh |
|---|---|---|
| Cinematic Luxury đen/trắng toànpage,Observe monochrome | body slate50,textslate900,teal700brand,SegoeUI/system | Hero homepage có thể deepteal/slate900 +trắng, phần xe vẫnlight; không đổitheme toànapp |
| Clash/PlusJakarta/InstrumentSerif/Inter/JetBrains mỗi trang | font-sans SegoeUI/system,hỗtrợcopytiếngViệt hiệncó | Một font hiệncó cho toànUI; số tabular-nums,khôngthêm font/CDN |
| Fullscreenvideoautoplay,preloadauto,nowrap/no-scroll | Homepage tìmxe/thẻAPI phải cuộn/mobile | Khôngbắtbuộcvideo: dùng CSSgradient/localillustration đãcó, khônglấy demoảnhxe làmDBmedia; headlinewrap, trangcuộn, header/footer khôngchecontent |
| Reveal1.2s,alltransition400ms,magnet/shimmer/pulse liên tục | Form/checkbox/pending/nghiệp vụ cần phản hồi nhanh | Transition targeted160–240ms; transform/opacity,boundedstagger nếu cần; reduced-motion,noinfiniteFAB/counters/glows |
| Dashboardblurple/tỷgiá/AIinsights/+100% | /adminindex chỉ screen(DashboardPage demo),API fallback;C12metrics chưachốt | Guidelinesreference,khôngtriểnkhai analytics/APIgiả; chỉ dữliệu đượcbackendchứngminh hoặc trạngtháichờkếtnối |
| Waitlistemail/Contact/play/social/studioObserve | KDriveCTAxe/auth/booking | CTA routeđúngactor; khôngthuemail/contact/play nếu khôngworkflow/source,dùngnội dungthuêxe tiếngViệt |
| Card/filter/table gợiý chưacópromptchi tiết | VehicleCard/sharedPageKit,ApiScreens,editoramenitiesC10A | Promptcomponentsphía dưới thốngnhấtID/label/VND/status/empty/error vàexistingAPI |

## 1. Prompt homepage/giới thiệu — phạm vi triển khai lượt này

Bạn cải thiện homepage API của KDrive, hệ thống thuêxe tựlái React/Vite/JS/Tailwind/Lucide hiệncó. Source ApiHomePage trong frontend/src/pages/api/ApiScreens.jsx,route /. Giữ hợpđồngAPI/auth/routing/backend; táidùng PageKit/VehicleCard,không tạo websiteHTML mới hoặc đổiTypeScript/UIframework.

Phongcách premium nhưng cùng hệthống: teal700 #0f766e,teal800 #115e59,slate900 #0f172a,textslate700, nền #f8fafc,panelwhite,borderslate200. Có thể hero deepteal/slate với gradient CSS nhẹ; phần nội dung API light. Font SegoeUI/system nhưindex.css; heading responsive khoảng36–56px desktop,28–36pxmobile,wrap tiếngViệt dễđọc; body16px/lineheight thoáng. Không text9xl/tracking cựcđoan/nhãn thừa. Giữ brandKDrive,header/login/menu/footer hiệncó.

Hero có lời hứa thực: tìmxe/tuyến nhậntrả và kiểmtra báo giá/lịch qua backend. Primary Xemxe→/vehicles; Guestsecondary đăngnhập/đăngký; USER có đơnthuê/hồsơ đúngroute; Staff/Admin khôngCTA nghiệpvụUser sai quyền. Không claimAIrecommendation/map/instantpayment hoặc phầmcọcchưaduyệt. Dướihero giữ search và danh sách tốiđa6xe đượcAPI trả,giáVND/tìnhtrạng/chips tiệnnghi thật. Không KPI/fleetcount/testimonial/social giả. Nhấn mạnh availability đượckiểm ởquote,ACTIVEkhông đồngnghĩa rảnhmọilịch.

Hero khôngphụthuộcvideoInternet/fontCDN: mặc định CSSgradient/đồhọa trangtrí nhẹ; khôngfetchvideoObserve haylấyảnhdemo theo tênxe. Nếu sau này cầnvideo/ảnhhero, cóasset/provenance taskriêng; no media dependency blocker cho lượt này. Header/footer flow/sticky phùhợp, khôngabsolute checontrols; homepagecuộn bìnhthường. Glass chỉ badge/control phụ nếu đọc tốt, khôngblurtoànpage.

Motion targeted160–240ms,focus-visible rõ,reduced-motion tắt reveal/scale,busy buttons không animationdelay. Mobile390/tablet768/desktop1280: khôngoverflowngang,CTA đủ44px,filterwrap,headlinedễđọc. APIloading/error/retry/empty trungthực; không thay lỗi bằngdemo. Xuất screenshotbeforeafter và kiểm actualbrowser, khôngchỉsửaCSS rồiclaimPASS.

## 2. Prompt dashboard quản trị — tham chiếu cho lượt sau, KHÔNG triển khai trong TASK này

Khi cóTASKdashboard riêng, dùngAdminLayout/Sidebar/WorkspaceTopbar hiệncó,teal/slate/fontcùnghomepage. Giữ labels/routes/role,sidebarresponsive khôngép240px gâyoverflow; stickyheader chỉnếukhôngchecontent. Card radius16–24px tùyPageKit,buttons/inputs12px,shadow-sm nhẹ; status successemerald/warningamber/errorrose, khôngđổi brand sangblurple. Numbers tabular-nums/VND nguyênđồng, khôngfont mới.

Chỉ hiểnthị metrics có API/definition/range/SQL evidence đãduyệt; doanhthu không gọi làđãthanhtoán nếuchưa cóproof. Không fake +100%,chart/randompaths/AIinsights/tỷgiáwidget/notificationbadge/FAB khôngworkflow. ChưaAPI thìrender trạngtháichờkếtnối trungthực; khônglấy demoDashboard làmAPI. Charts/filtertime chỉsauC12scope/contract; nocloudAIcalls/provider. Tables loading/error/empty/retry, số/headers/timestampAsiaHoChiMinh theohelpers. Motiontránh transitionall/shimmerinfinite/counters giả;reducedmotion/keyboard/mobile/contrast và browserdataproof bắtbuộc.

Guidelines này khôngcấpquyền sửaAdminLayout/DashboardPage/router/C12 trong lượt homepage+C10A; giữ chúng để thốngnhất khi bàn giao sau.

## 3. Prompt component nhỏ — cardxe/filter/tiệnnghi

Tái dùng components hiệncó, không tạo design system mới. Cardxe: cùngradius/border/shadow/tealCTA, tênhãngxe/loạixe/giáVND/sốchỗ/hộpsố từAPI; amenities:[{id,name}] mapchínhxác,chips tốiđa3ởcard, detailđầyđủ; khôngdùngtênthiếuID làmkey hoặcnhận toàncatalog làmđãgán. KhôngảnhAPI thìplaceholderẢnhchưacậpnhật (C10Bpending),khônglấy localdemoảnhxe đểgiảdata. NhãnACTIVE diễnđạt trạngtháikhai thác, không khẳngđịnh available mọi lịch.

Filter: giữsemantics hiệncó,labelsvisible/keyboard/resetnếucóworkflow,gọnresponsive,tránh inputchỉplaceholder; emptynoresult phânbiệtAPIerror, retryactualrequest; không showfilter khôngcólogic/backendcontract.

Tiệnnghi: public chips/listtext chứkhôngbảngCRUD; Admin editorcheckboxcatalog cólabel/fieldset/loading/error/retry/empty, hiệnlinks xe đangedit;save riêng PUT amenities với expectedRevision thật. Pendingref synchronous1PUT;400giữlựa chọn/giảiphóngguard;409khôngfalse-success,thôngbáonhìnthấy,tảilạifreshstate rồi subsequentPUT dùngfreshrevision. [] bỏlinks riêngxe,khôngxóacatalog;Staffread-only,noAdmincontrols. Giữ bố cục formcũ,nokeyremount gây staleerrorbiếnmất khôngđượctest. Testactualsource/mountedcomponents,khôngmirror normalize function đểPASS.

Thốngnhấtvisual trênpage đangdùngsharedcomponents qua regression/screenshots; khôngrestyle toànbộUser/Staff/Admin nếukhôngTASK. TiếngViệt/nộidung rõ,tooltips khôngthaylabel,motion ít/contrast/focus/tap tốt,khôngthêmdependency.
