# Coursera Pro Tool 🚀

Công cụ tiện ích mở rộng Chrome (Manifest V3) chuyên nghiệp hỗ trợ học tập và tự động hóa trên Coursera.

## ✨ Tính năng chính

1. **Bypass Week Materials (Tự động hoàn thành Video & Bài đọc)**:
   - Sử dụng cơ chế Single Background Tab thông minh: không mở nhiều tab gây giật lag.
   - Tự động tắt tiếng, tua nhanh video đến sát thời lượng kết thúc để kích hoạt sự kiện hoàn thành của Coursera.
   - Tự động cập nhật tích xanh 100% sau khi hoàn tất.

2. **Auto Quiz Solver (Giải bài tập trắc nghiệm AI)**:
   - Tự động quét đề bài, câu hỏi và các phương án trả lời.
   - Sử dụng Gemini API (Gemini 2.5 Flash / Pro) để phân tích và chọn đáp án chính xác nhất.
   - Hỗ trợ câu hỏi đơn, đa lựa chọn và tự động nộp bài (Auto Submit).

3. **Auto Discussion Forum (Tự động thảo luận diễn đàn)**:
   - Cơ chế Zero-Navigation: Xử lý 100% ngầm, người dùng giữ nguyên URL hiện tại.
   - Tự chuẩn hóa URL hợp lệ (`/item/:id` hoặc `/discussionPrompt/:id/:slug`), triệt tiêu hoàn toàn lỗi 404.
   - Tự động sinh phản hồi học thuật chất lượng cao (100 - 180 từ).
   - Tích hợp cơ chế Anti-Spam / Anti-Ban: Giãn cách 30s - 40s ngẫu nhiên giữa các bài đăng kèm đồng hồ đếm ngược trực quan.

4. **Auto Peer Review (Chấm chéo bạn học tự động)**:
   - Tự động quét tiêu chí chấm điểm (Rubric).
   - Chấm điểm tối đa và sinh nhận xét xây dựng, tích cực cho bạn học.

5. **Disable AI Grading & Direct Shareable Review Link**:
   - Trực tiếp trích xuất đường dẫn chia sẻ nộp bài Peer-graded Assignment.
   - Vượt qua các giới hạn AI chấm bài tự động.

---

## 🛠️ Hướng dẫn cài đặt trên trình duyệt Chrome

1. Clone hoặc tải mã nguồn về máy tính:
   ```bash
   git clone <URL_REPOSITORY>
   ```
2. Mở trình duyệt Google Chrome và truy cập đường dẫn:
   ```text
   chrome://extensions/
   ```
3. Bật công tắc **Developer mode (Chế độ dành cho nhà phát triển)** ở góc trên bên phải.
4. Bấm vào nút **Load unpacked (Tải tiện ích đã giải nén)**.
5. Chọn thư mục `coursera-pro-tool` (hoặc thư mục `dist/`).
6. Mở Coursera và tận hưởng các tính năng trên Floating Panel Cyberpunk!

---

## ⚙️ Cấu hình API Key
- Bấm vào icon tiện ích trên thanh công cụ của Chrome.
- Nhập Google Gemini API Key của bạn (lấy miễn phí tại [Google AI Studio](https://aistudio.google.com/)).
- Chọn mô hình mong muốn (khuyến nghị: `gemini-2.5-flash`).
- Bấm **Save Key**.
