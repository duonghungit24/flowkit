# 📋 Thông tin cần cho project

> Form khung dùng cho `/fk-create-project`. Copy file này, đổi tên, điền hết rồi gửi lại để skill chạy mà không phải hỏi thêm.

## 1. Project name & story
- **Tên project:** ?
- **Story (tóm tắt cốt truyện ngắn, 2–4 câu):** ?

## 2. Material (visual style) — chọn 1 trong 13

| ID | Tên | Phong cách |
|---|---|---|
| `realistic` | Photorealistic | Phim/ảnh thật |
| `3d_pixar` | 3D Pixar | Hoạt hình Pixar |
| `anime` | Anime | Anime Nhật cel-shaded |
| `ghibli` | Studio Ghibli | Watercolor mềm mại |
| `stop_motion` | Felt & Wood | Stop-motion thủ công |
| `claymation` | Claymation | Đất sét Wallace & Gromit |
| `minecraft` | Minecraft | Block voxel |
| `lego` | LEGO | LEGO minifigure |
| `oil_painting` | Oil Painting | Tranh sơn dầu cổ điển |
| `watercolor` | Watercolor | Màu nước mềm |
| `comic_book` | Comic Book | Truyện tranh Marvel/DC |
| `cyberpunk` | Cyberpunk | Neon đêm tối |
| `retro_vhs` | Retro VHS | Băng VHS 80s |

> Nếu muốn style khác → tạo custom material qua `/fk-add-material`. Có thể chạy `GET /api/materials` để liệt kê hiện có.

**Chọn:** `__________`

## 3. Characters (nhân vật)

Mỗi nhân vật cần:
- **Tên** — alias dùng xuyên suốt project
- **Mô tả ngoại hình base** — mô tả **1 outfit mặc định duy nhất** (tóc, mặt, dáng người, tuổi, trang phục mặc định, đặc điểm nhận dạng)
- **voice_description** — giọng nói ~30 từ (tone, tốc độ, accent, cảm xúc nền)

> ⚠️ Mô tả là **mặc định**, **KHÔNG** mô tả outfit theo từng scene tại đây.
> Outfit khác nhau giữa các scene → viết trong **scene prompt**, không sửa character description.
> Reference image phải là **1 ảnh sạch, không phải multi-panel grid**.

| Tên | Mô tả ngoại hình base (1 outfit) | voice_description (~30 từ) |
|------|----------------------------------|----------------------------|
|      |                                  |                            |
|      |                                  |                            |

## 4. Locations (địa điểm)

Mỗi location cần:
- **Tên**
- **Mô tả không gian** (kiến trúc, ánh sáng, thời gian trong ngày, không khí, chi tiết môi trường)

| Tên | Mô tả không gian |
|------|------------------|
|      |                  |
|      |                  |

## 5. Visual assets (props / đồ vật quan trọng)

Mỗi asset cần:
- **Tên**
- **Mô tả** (hình dáng, chất liệu, màu sắc, trạng thái, đặc điểm nhận dạng)

> Chỉ liệt kê những asset xuất hiện ở **nhiều scene** hoặc cần **giữ nhất quán visual**. Đồ vật xuất hiện 1 lần → mô tả thẳng trong scene prompt.

| Tên | Mô tả |
|------|-------|
|      |       |
|      |       |

## 6. Số scene & orientation
- **Số scene:** ? *(ví dụ 5 / 8 / 12 — short ~6, long ~12)*
- **Orientation:**
  - ⬜ `VERTICAL` (9:16) → YouTube Shorts, TikTok, Reels
  - ⬜ `HORIZONTAL` (16:9) → YouTube long-form, web

## 7. Tuỳ chọn thêm
- **Ngôn ngữ narrator:** `__________` *(vd `en`, `vi` — mặc định `en`)*
- **Bật narrator?** ⬜ `allow_voice = true`  ⬜ `allow_voice = false` *(mặc định false)*

---

## ⚠️ Nếu character là người thật nổi tiếng (chính trị / quân sự / celeb)

- [ ] Bật chế độ **alias tiếng Anh** (vd: `The Commander`, `Iron Premier`)
- [ ] Mô tả character chỉ ngoại hình, **KHÔNG** tên thật
- [ ] Ref image dùng **back-view / side-profile**
- [ ] Tất cả scene prompt giữ camera **sau lưng / bên hông**, không quay mặt

| Alias (English) | Real reference (chỉ nội bộ) |
|-----------------|------------------------------|
|                 |                              |
