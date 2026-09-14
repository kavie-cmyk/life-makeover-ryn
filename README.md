# Ryn Wardrobe Lab — Life Makeover

Web app cá nhân để quản lý wardrobe Life Makeover và trả lời 3 câu hỏi chính:

1. Với từng thuộc tính, bộ đồ mạnh nhất hiện tại của mình đạt bao nhiêu điểm?
2. Bộ đó có bao nhiêu món 6★, 5★, 4★, 3★ và đang dùng những món nào?
3. Món tiếp theo nên săn là gì để tăng tổng điểm nhiều nhất?

## Tính năng

- Inventory cho item **Đang sở hữu** và **Mục tiêu / chưa có**.
- Hỗ trợ 10 style: Cool, Elegant, Fresh, Gorgeous, Lively, Pure, Sexy, Simple, Sweet, Warm.
- Hỗ trợ các fashion type chính: Hairstyle, Dress, Coat, Top, Bottom, Socks, Shoes và toàn bộ nhóm accessory/special phổ biến.
- Tự tạo **best set theo từng style**.
- Xử lý **Dress vs Top + Bottom** như hai phương án cạnh tranh, không cộng sai cả ba.
- Thống kê tổng điểm, số item và số món theo rarity của nguyên best set.
- **Upgrade simulation**: item có trạng thái `target` được giả lập thêm vào wardrobe; app tính lại best set và xếp hạng theo số điểm tăng thêm.
- Nếu chưa có candidate cụ thể, app chỉ ra các slot/rating yếu để biết nên săn loại item nào trước.
- Import/export JSON để backup.
- Import CSV để nhập nhiều món nhanh.
- Responsive cho desktop và mobile.
- Dữ liệu lưu bằng `localStorage` trên browser hiện tại.

## Cách dùng nhanh

1. Mở app, bấm **Thêm món**.
2. Nhập tên, slot, rarity và điểm theo các thuộc tính của item.
3. Item đang có chọn **Đang sở hữu**.
4. Item đang cân nhắc kiếm chọn **Mục tiêu / chưa có**.
5. Vào **Best set** để xem bộ mạnh nhất theo từng thuộc tính.
6. Vào **Nên săn gì?** để xem candidate nào tăng điểm nhiều nhất và nó thay món nào.

## Nhập nhiều item

Vào tab **Dữ liệu** → **Tải CSV mẫu**. Điền file rồi import lại. Các cột điểm không dùng có thể để `0` hoặc trống.

## Scoring model

- Mỗi fashion type lấy item đang sở hữu có điểm style cao nhất.
- Dress và Top + Bottom được so sánh riêng; app chọn phương án có tổng điểm cao hơn.
- Điểm nhập vào được coi là **điểm hiệu lực hiện tại** của item. Nếu dye/palette làm rating tăng, hãy nhập rating sau nâng cấp để optimizer phản ánh đúng wardrobe hiện tại.
- Item `target` không được tính vào current best set; chỉ được dùng cho simulation.

## Data privacy

Hiện tại inventory không được commit vào GitHub. Dữ liệu cá nhân nằm trên browser dưới key `rynWardrobeLab.v1`. Dùng **Xuất JSON** để backup hoặc chuyển sang thiết bị khác.

## Development

App là static HTML/CSS/JS, không cần build step.

GitHub Actions workflow `.github/workflows/validate.yml` chạy `node --check app.js` và kiểm tra các file bắt buộc sau mỗi push/PR vào `main`.
