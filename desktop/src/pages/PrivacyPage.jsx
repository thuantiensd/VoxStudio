import { useNavigate } from "react-router-dom";
import { useT } from "../i18n/I18nContext";
import { LegalLayout } from "./TermsPage";

/**
 * Chính sách bảo mật — minimum cho launch nhỏ. Tuân thủ cơ bản
 * Nghị định 13/2023 (VN) + GDPR-friendly.
 */
export default function PrivacyPage() {
  const t = useT();
  const nav = useNavigate();
  return (
    <LegalLayout title={t("legal.privacy.title")} onBack={() => nav(-1)}>
      <p className="muted">{t("legal.lastUpdated")}: 26/04/2026</p>

      <Section title="1. Dữ liệu chúng tôi thu thập">
        <p>Khi bạn dùng VoxStudio, chúng tôi lưu các loại dữ liệu sau:</p>
        <ul>
          <li>
            <b>Thông tin tài khoản</b>: email, tên, mật khẩu (đã hash bcrypt —
            chúng tôi không thấy mật khẩu gốc của bạn).
          </li>
          <li>
            <b>Voice embedding</b>: vector số học trích xuất từ audio mẫu bạn upload
            khi clone giọng. Audio mẫu gốc bị xoá ngay sau khi tạo embedding;
            chỉ vector được lưu trên máy chủ.
          </li>
          <li>
            <b>Nội dung bạn tạo</b>: text input cho TTS, project lồng tiếng, file
            phụ đề. Lưu để bạn xem/dùng lại.
          </li>
          <li>
            <b>Lịch sử sử dụng</b>: số phút dub, số ký tự TTS, timestamp các action —
            dùng để tính quota gói trả phí.
          </li>
          <li>
            <b>Audit log</b>: IP, user agent, thời gian login/register/delete account
            — dùng cho bảo mật + điều tra lạm dụng.
          </li>
          <li>
            <b>Cookies / localStorage</b>: lưu JWT token, locale, theme, preferences —
            tất cả cục bộ trên máy bạn, không gửi server.
          </li>
        </ul>
      </Section>

      <Section title="2. Chúng tôi KHÔNG thu thập">
        <ul>
          <li>Audio mẫu gốc của bạn (chỉ giữ embedding sau khi clone).</li>
          <li>Audio output sau 24h (TTL cleanup tự động).</li>
          <li>Vị trí địa lý (chỉ IP cho audit, không tracking di chuyển).</li>
          <li>Danh bạ, ảnh, file khác trên máy bạn.</li>
          <li>API key của các nhà cung cấp khác (OpenAI, DeepL, Gemini…) —
            lưu trong OS Keychain trên máy bạn (Electron) hoặc localStorage (web),
            chỉ gửi trực tiếp tới nhà cung cấp khi dịch.</li>
        </ul>
      </Section>

      <Section title="3. Mục đích sử dụng dữ liệu">
        <ul>
          <li>Vận hành dịch vụ (tạo TTS, clone voice, lồng tiếng).</li>
          <li>Tính quota gói trả phí.</li>
          <li>Bảo mật & chống lạm dụng (rate limit, audit log).</li>
          <li>Liên hệ với bạn (thông báo verify email, cập nhật quan trọng).</li>
        </ul>
        <p>
          <b>Chúng tôi KHÔNG dùng dữ liệu của bạn để:</b> train AI model,
          bán cho bên thứ ba, gửi spam marketing, profiling cho ads.
        </p>
      </Section>

      <Section title="4. Bên thứ ba">
        <p>Chúng tôi chia sẻ dữ liệu rất hạn chế:</p>
        <ul>
          <li>
            <b>Cloud hosting</b>: server của chúng tôi chạy trên cloud
            (vd AWS/GCP). Họ thấy data ở mức infrastructure (encrypt at rest +
            in transit) nhưng không xem nội dung cụ thể.
          </li>
          <li>
            <b>Khi bạn dùng API key cá nhân</b> (OpenAI, Gemini…) cho dịch:
            text input gửi trực tiếp tới nhà cung cấp đó — VoxStudio chỉ là
            relay. Vui lòng đọc privacy policy của họ.
          </li>
          <li>
            <b>Cơ quan chức năng</b>: nếu có yêu cầu pháp lý hợp lệ (toà án,
            công an), chúng tôi sẽ cung cấp data tối thiểu cần thiết.
          </li>
        </ul>
      </Section>

      <Section title="5. Quyền của bạn (theo Nghị định 13/2023 & GDPR)">
        <p>Bạn có các quyền sau bất cứ lúc nào:</p>
        <ul>
          <li>
            <b>Xem dữ liệu cá nhân</b>: trang Cài đặt → Tài khoản hiển thị toàn
            bộ thông tin chúng tôi giữ.
          </li>
          <li>
            <b>Sửa thông tin</b>: tự sửa email/tên trong Cài đặt.
          </li>
          <li>
            <b>Xoá tài khoản & toàn bộ dữ liệu</b>: Cài đặt → Tài khoản → "Xoá tài
            khoản". Hard-delete ngay lập tức, không grace period, không khôi phục.
          </li>
          <li>
            <b>Yêu cầu xuất dữ liệu</b>: email{" "}
            <a href="mailto:privacy@voxstudio.app" style={{ color: "var(--accent)" }}>
              privacy@voxstudio.app
            </a>{" "}
            — chúng tôi gửi file JSON trong 30 ngày.
          </li>
          <li>
            <b>Phản đối / khiếu nại</b>: liên hệ email trên hoặc cơ quan có thẩm quyền.
          </li>
        </ul>
      </Section>

      <Section title="6. Thời gian lưu trữ">
        <ul>
          <li>Tài khoản + voice embedding: lưu cho tới khi bạn xoá.</li>
          <li>Audio output (TTS): tự xoá sau 24h.</li>
          <li>Audit log: 12 tháng (mục đích bảo mật).</li>
          <li>Sau khi bạn xoá account: tất cả data của bạn bị wipe ngay,
            audit log được anonymize (xoá user_id liên kết).</li>
        </ul>
      </Section>

      <Section title="7. Bảo mật">
        <ul>
          <li>HTTPS encrypt mọi traffic.</li>
          <li>Mật khẩu hash bcrypt (không thể đọc ngược).</li>
          <li>JWT token có expiry, chỉ dùng trên client của bạn.</li>
          <li>Voice clone scope per-user (folder riêng), check ownership ở mọi endpoint.</li>
          <li>API keys của bạn (OpenAI…) lưu OS Keychain trên máy bạn.</li>
        </ul>
      </Section>

      <Section title="8. Trẻ em">
        <p>
          Dịch vụ không dành cho người dưới 16 tuổi (theo Luật trẻ em VN).
          Nếu chúng tôi phát hiện tài khoản thuộc trẻ em, sẽ xoá ngay.
        </p>
      </Section>

      <Section title="9. Thay đổi chính sách">
        <p>
          Khi cập nhật chính sách quan trọng, chúng tôi sẽ gửi email thông báo
          và yêu cầu đồng ý lại trước khi tiếp tục dùng.
        </p>
      </Section>

      <Section title="10. Liên hệ">
        <p>Câu hỏi về quyền riêng tư:{" "}
          <a href="mailto:privacy@voxstudio.app" style={{ color: "var(--accent)" }}>
            privacy@voxstudio.app
          </a>
        </p>
      </Section>
    </LegalLayout>
  );
}

function Section({ title, children }) {
  return <section><h2>{title}</h2>{children}</section>;
}
