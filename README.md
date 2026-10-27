# Siris Operations Web

## Bản online trên Vercel

Mã nguồn gồm giao diện hiện có và API tại `api/index.js`. Bản online dùng đăng nhập Lark và gọi Base bằng quyền người đang đăng nhập; không dùng phiên CLI trên Mac. Cấu hình các biến trong `.env.example` ở phía máy chủ Vercel, đặt callback Lark là `APP_URL/api/auth/callback`, rồi build bằng `node scripts/build.mjs` (thư mục xuất `public`). Không đưa giá trị bí mật vào mã nguồn hoặc biến frontend.

Phiên đăng nhập được mã hóa trong cookie Secure, HttpOnly với thời hạn tối đa 7 ngày. Ứng dụng không dùng Redis hoặc Vercel Blob. Ảnh được lưu trong trường đính kèm hiện có của Lark; ảnh tải lên lớn được tối ưu trước khi gửi, GIF quá lớn cần giảm dung lượng hoặc tải bằng Lark. Bản online không chạy tác vụ lấy điểm OTA tự động; vẫn xem dữ liệu Review và sửa điểm bằng tay.

Phần tích hợp online đang trong quá trình nghiệm thu: cần hoàn tất cấu hình/phát hành ứng dụng Lark và kiểm tra bằng tài khoản quản lý, nhân viên khác quyền, cùng các luồng ảnh và chỉnh sửa thực tế trước khi mở cho nhân viên. Kiểm tra tự động bằng `npm test` không thay thế bước đối chiếu quyền trên Base thật.

Repo chỉ chứa mã nguồn, tài nguyên giao diện và cấu hình mẫu. Các file `.env`, dữ liệu xuất, nhật ký, ảnh chụp màn hình và cấu hình đăng nhập Vercel được loại trừ.

Website độc lập, đọc dữ liệu trực tiếp từ các bảng trong Lark Base Siris Residences: `Quỹ tiền mặt`, `Quỹ`, `Lịch sử thu tiền mặt`, `Lịch sử chi tiền mặt`, `Ngắn hạn`, `Sửa chữa`, `Mua sắm`, `Loại tài sản` và `Yêu cầu thanh toán`. Bảng `Cơ sở` được đọc thêm để đối chiếu phòng/toà nhà; bảng `Liên hệ` được dùng để hiện tên người thực hiện sửa chữa và người thụ hưởng thanh toán.

## Chạy thử trên máy này

Yêu cầu Node.js 24+, `lark-cli` đã đăng nhập bằng profile `cli_aa535e128479df04` và có quyền đọc Base. Tạo `.env` chứa `LARK_BASE_TOKEN` của Base cần dùng (không commit file này). Trong thư mục này, chạy:

```bash
npm start
```

Mở `http://127.0.0.1:4173`. Máy chủ chỉ lắng nghe địa chỉ loopback. Frontend không chứa token truy cập; máy chủ gọi `lark-cli` để đọc Base. Trang tự đọc lại Base mỗi 60 giây khi đang mở và kiểm tra ngay khi người dùng quay lại tab sau ít nhất 60 giây. Nút **Làm mới** buộc đọc lại ngay. Dữ liệu được giữ trong bộ nhớ máy chủ tối đa 60 giây giữa các lần đọc thường; các lần tự cập nhật bỏ qua bộ nhớ đệm. Mục **Nhập liệu** trên thanh điều hướng có biểu mẫu cho Quỹ tiền mặt, Lịch sử thu, Lịch sử chi, Dọn phòng ngắn hạn, Lịch sử sửa chữa và Yêu cầu thanh toán. Các liên kết Quỹ/Thu/Chi cho phép chọn nhiều bản ghi. Bút toán Quỹ có lựa chọn riêng cho lịch sử thu và lịch sử chi, theo loại nạp/rút; biểu mẫu thu/chi lấy lựa chọn phòng và vị trí từ bảng Cơ sở. Lịch sử thu có thể ghi nhân viên và số tiền cá nhân đã ứng để thối tiền. Danh sách nhân viên chỉ hiện tài khoản Lark đã xác minh đang hoạt động; khi thiếu quyền `contact:user:search`, trường nhân viên được khóa để tránh chọn người đã nghỉ. Sau khi ghi, máy chủ xoá bộ nhớ đệm và web đọc lại Base.

Nếu Lark CLI báo không đọc được macOS Keychain khi chạy trong môi trường tự động, hãy chạy `npm start` trong Terminal tương tác đã đăng nhập Lark. Không chuyển khóa hoặc token vào frontend.

Các lựa chọn nhập liệu như toà, nội dung thu/chi, trạng thái sửa chữa và mục đích thanh toán được đọc từ cấu hình trường của Lark Base. Web và máy chủ làm mới danh sách này định kỳ; lựa chọn đã xoá khỏi Base không còn xuất hiện trong biểu mẫu và không được chấp nhận khi lưu.

Trong biểu mẫu lịch sử sửa chữa, mục **Người thực hiện** có ô tìm theo tên và gợi ý từ các ca đã ghi trong Base. Gợi ý ưu tiên nội dung sự cố có từ khoá chung, cùng toà và cùng phòng; chọn gợi ý chỉ điền người thực hiện vào biểu mẫu, không tự tạo bản ghi. Gợi ý phản ánh lịch sử, không xác nhận người đó hiện còn nhận việc.

Trên lịch dọn phòng, nút **+** ở mỗi ngày mở biểu mẫu với ngày đó điền sẵn; chọn toà, phòng, tình trạng và ghi chú để tạo lượt dọn. Bấm tên một phòng trên lịch để mở đúng bản ghi và sửa thông tin; kéo tên phòng sang ô ngày khác để chuyển ngày trong Base. Lượt dọn hiện ở ngày mới ngay khi thả; web lưu vào Base sau đó và tự đưa về ngày cũ nếu lưu lỗi. Trong popup, để trống cả hai ô tình trạng nghĩa là chưa đánh dấu. Biểu mẫu Dọn phòng ngắn hạn trong tab Nhập liệu và biểu mẫu Lịch sử sửa chữa nhận ảnh vào trường **Hình ảnh** đã có. Biểu mẫu Yêu cầu thanh toán cho chọn trường **Biên nhận** hoặc **Hoá đơn** đã có. Các bảng nhập liệu không có trường đính kèm sẽ không hiện ô chọn ảnh; web không tạo thêm trường trong Base.

## Lưu ý nghiệp vụ

- Đồng bộ tab OTA chạy nền trên Mac bằng LaunchAgent; lịch được kiểm tra lúc 09:00 hằng ngày để bắt kịp thứ Hai bị lỡ khi Mac ngủ, còn đồng bộ thường chạy mỗi tuần một lần. Nếu một lượt lỗi hoặc chỉ đọc được một phần, hệ thống thử lại một lần vào sáng hôm sau. Khi đăng nhập Lark trên Mac, tác vụ kiểm tra lịch quá hạn và chạy bù. Nhật ký nằm ở `~/Library/Logs/Siris/review-ota.json`; chạy thủ công bằng `node review-sync.mjs --run-now`. Cần giữ Mac bật và đăng nhập tài khoản macOS; không cần mở web. Link bị OTA chặn hoặc không xác minh được sẽ giữ nguyên điểm/số cũ và hiện trên trạng thái tab OTA.

- `Chênh lệch quỹ ghi sổ` là tổng trường `Số tiền` của riêng bảng `Quỹ tiền mặt`; đây không phải xác nhận số tiền mặt thực tế.
- Dòng Quỹ hiển thị người nộp/rút từ trường hệ thống `Tạo bởi` của bản ghi.
- Tab điều hướng `Dọn phòng ngắn hạn` hiển thị lịch theo tháng từ bảng `Ngắn hạn`, nhóm lượt dọn theo ngày và toà, kèm phòng, trạng thái `Đã dọn`, `Khách yêu cầu không dọn` và ghi chú. Bảng hiện không có trường tên nhân viên dọn nên web không suy đoán người thực hiện. Bản ghi thiếu ngày được báo riêng và không thể xếp vào ô lịch.
- Trang `Lịch sử sửa chữa` hiển thị toàn bộ bảng `Sửa chữa`, lọc theo từ khoá, toà, trạng thái và tháng. Tên người thực hiện lấy qua liên kết `Liên hệ`; vị trí lấy qua `Cơ sở`. Tổng chi phí chỉ cộng các bản ghi có điền trường `Chi phí`, và hiện số bản ghi đã có chi phí để tránh hiểu nhầm các ô trống là 0.
- Trang `Yêu cầu thanh toán` hiển thị ngày, nội dung, số tiền, trạng thái đã chi, mục đích chi, hình thức chi, người yêu cầu và người thụ hưởng. Nếu yêu cầu liên kết với lịch sử sửa chữa hoặc mua sắm, các bản ghi liên quan hiện ngay dưới yêu cầu. Có thể tìm kiếm và lọc theo trạng thái hoặc mục đích. Số tiền đã chi chỉ cộng các yêu cầu đánh dấu `Đã chi` có số tiền; màn hình này không thực hiện thanh toán hay sửa bản ghi.
- Các bảng lịch sử thu và chi là nguồn riêng. Chúng không được cộng lần nữa vào chênh lệch quỹ.
- Lịch sử thu hiển thị `Khách trả` dưới nhãn **Khách đưa** và `Thực nhận` ở cột tiền. Checkbox `Đã thối tiền` được hiển thị đúng theo Base. Chỉ khi `Số tiền nhân viên ứng` có giá trị lớn hơn 0, dòng thu mới hiển thị số tiền và tên người thối; ô trống được hiểu là không ứng. Không suy ra tiền nhân viên ứng từ chênh lệch `Khách trả` và `Thực nhận`.
- Trên mỗi dòng thu và chi, rê chuột hoặc chuyển tiêu điểm bàn phím vào **Lịch sử bỏ quỹ** / **Lịch sử lấy quỹ** để xem các bút toán Quỹ được liên kết. Web tìm liên kết từ cả hai phía Thu/Chi và Quỹ; nếu không có liên kết ở cả hai phía thì hiện trạng thái chưa liên kết.
- Mỗi bút toán Quỹ có liên kết Thu/Chi sẽ hiển thị chi tiết từ bản ghi liên kết: nội dung, ngày, toà/vị trí, số tiền và ghi chú. Tìm kiếm cũng xét những chi tiết này.
- Có thể lọc riêng từng bảng theo toà nhà, phòng và khoảng ngày. Danh sách phòng lấy từ liên kết `Phòng` ở lịch sử thu và trường `Vị trí` ở lịch sử chi. Khi toà nhà trên giao dịch khác toà nhà của phòng liên kết, bộ lọc ưu tiên toà nhà trên giao dịch.
- Bút toán chưa có ngày hoặc số tiền vẫn xuất hiện trong sổ; số tiền trống không được tính vào tổng.
- Bản thử nghiệm dùng dữ liệu tài chính nội bộ. Chỉ mở bản online cho nhân viên sau khi hoàn tất các bước nghiệm thu đăng nhập và phân quyền nêu ở trên.

Tab Review → OTA hiển thị bảng so sánh theo nền tảng với hai cột Lune/Mia. Airbnb mở chi tiết từng loại phòng; bộ lọc toà và link cần kiểm tra cập nhật cả số tổng hợp. Bấm trạng thái mỗi link để xem lỗi, lần kiểm tra OTA và thời điểm sửa trong Base.

Trong dashboard OTA, mỗi link hiển thị lần cập nhật Base gần nhất và có nút Sửa điểm. Lưu điểm ghi trực tiếp vào trường Điểm review của bản ghi đó, giữ số lượng review. Điểm Airbnb nhận 0–5, các OTA khác 0–10. Đồng bộ tự động vẫn có thể cập nhật lại điểm khi đọc được số liệu mới từ OTA.
