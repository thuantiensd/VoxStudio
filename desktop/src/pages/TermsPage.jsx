import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useT } from "../i18n/I18nContext";

/**
 * Điều khoản dịch vụ — bản tối thiểu cho launch nhỏ. Có thể thay bằng
 * bản pháp lý đầy đủ sau (Termly, hoặc luật sư review).
 */
export default function TermsPage() {
  const t = useT();
  const nav = useNavigate();
  return (
    <LegalLayout title={t("legal.terms.title")} onBack={() => nav(-1)}>
      <p className="muted">{t("legal.lastUpdated")}: 26/04/2026</p>

      <Section title="1. Chấp nhận điều khoản">
        <p>
          Khi đăng ký và sử dụng VoxStudio, bạn xác nhận đã đọc, hiểu và đồng ý
          với toàn bộ Điều khoản này. Nếu không đồng ý, vui lòng không sử dụng
          dịch vụ.
        </p>
      </Section>

      <Section title="2. Mô tả dịch vụ">
        <p>
          VoxStudio cung cấp công cụ AI để: (a) chuyển văn bản thành giọng nói (TTS),
          (b) trích xuất phụ đề từ audio/video (STT), (c) lồng tiếng video,
          (d) clone giọng từ mẫu audio người dùng cung cấp. Dịch vụ chạy trên hạ
          tầng cloud của chúng tôi và yêu cầu kết nối internet.
        </p>
      </Section>

      <Section title="3. Tài khoản & Trách nhiệm người dùng">
        <ul>
          <li>Bạn chịu trách nhiệm bảo mật mật khẩu tài khoản.</li>
          <li>Mỗi tài khoản chỉ dành cho 1 người. Không chia sẻ tài khoản.</li>
          <li>
            Bạn xác nhận đủ 16 tuổi (theo Luật trẻ em VN) để sử dụng dịch vụ.
            Người dưới 16 tuổi cần có sự đồng ý của cha mẹ/người giám hộ.
          </li>
        </ul>
      </Section>

      <Section title="4. Voice Cloning — Quy định đặc biệt">
        <p>
          Clone giọng nói là tính năng có rủi ro lạm dụng cao. Bạn cam kết:
        </p>
        <ul>
          <li>
            <b>Chỉ clone giọng của chính bạn HOẶC giọng người đã đồng ý rõ ràng
            cho phép bạn clone</b> (bằng văn bản, tin nhắn, ghi âm, v.v.).
          </li>
          <li>
            <b>Không clone giọng người nổi tiếng, người không liên quan, người
            đã mất, trẻ em</b> mà không có quyền hợp pháp.
          </li>
          <li>
            <b>Không tạo nội dung lừa đảo, mạo danh, deepfake với mục đích xấu</b>
            (lừa tiền, bôi nhọ, vu khống, gây hại danh dự).
          </li>
          <li>
            Chịu mọi trách nhiệm pháp lý phát sinh từ giọng clone bạn tạo.
            VoxStudio không chịu trách nhiệm thay bạn.
          </li>
        </ul>
        <p>
          Khi tick checkbox "Tôi xác nhận có quyền sử dụng giọng" lúc clone,
          bạn xác lập một cam kết pháp lý ràng buộc với VoxStudio.
        </p>
      </Section>

      <Section title="5. Sở hữu nội dung">
        <p>
          Bạn giữ toàn bộ quyền sở hữu với <b>nội dung do bạn tạo ra</b> qua
          dịch vụ (audio TTS, video lồng tiếng, file phụ đề). VoxStudio không
          claim quyền với output của bạn.
        </p>
        <p>
          VoxStudio giữ quyền sở hữu mã nguồn, model AI, giao diện, thương hiệu,
          và toàn bộ tài sản trí tuệ của hệ thống.
        </p>
      </Section>

      <Section title="6. Hành vi bị cấm">
        <p>Bạn KHÔNG được dùng dịch vụ để:</p>
        <ul>
          <li>Tạo nội dung vi phạm pháp luật Việt Nam</li>
          <li>Quấy rối, đe doạ, bôi nhọ người khác</li>
          <li>Mạo danh người khác (đặc biệt qua voice clone)</li>
          <li>Phát tán malware, scam, phishing</li>
          <li>Reverse-engineer, scrape, hoặc abuse API hệ thống</li>
          <li>Vi phạm bản quyền (vd download video có copyright và monetize)</li>
        </ul>
        <p>
          Vi phạm sẽ dẫn tới khoá tài khoản ngay lập tức không hoàn tiền,
          và có thể bị báo cáo cơ quan chức năng.
        </p>
      </Section>

      <Section title="7. Thanh toán & Hoàn tiền">
        <ul>
          <li>Gói trả phí được tính theo chu kỳ tháng hoặc trọn đời.</li>
          <li>Bạn có thể huỷ gói bất cứ lúc nào — gói tiếp tục hoạt động đến hết chu kỳ đã trả.</li>
          <li>
            Hoàn tiền chỉ áp dụng trong 7 ngày đầu kể từ ngày mua, với điều kiện
            chưa dùng quá 10% quota của gói.
          </li>
        </ul>
      </Section>

      <Section title="8. Giới hạn trách nhiệm">
        <p>
          Dịch vụ được cung cấp "as-is" — không cam kết uptime 100%, không bảo đảm
          chất lượng output luôn đạt kỳ vọng (AI có thể tạo lỗi). VoxStudio không
          chịu trách nhiệm với thiệt hại gián tiếp (mất doanh thu, mất dữ liệu)
          phát sinh từ việc sử dụng dịch vụ.
        </p>
      </Section>

      <Section title="9. Chấm dứt">
        <p>
          Chúng tôi có quyền tạm ngưng hoặc khoá tài khoản nếu bạn vi phạm điều
          khoản. Bạn có thể tự xoá tài khoản qua Cài đặt → Tài khoản bất cứ lúc nào.
        </p>
      </Section>

      <Section title="10. Luật áp dụng & Liên hệ">
        <p>Điều khoản này tuân theo pháp luật Cộng hoà Xã hội Chủ nghĩa Việt Nam.</p>
        <p>
          Mọi khiếu nại / báo cáo lạm dụng:{" "}
          <a href="mailto:support@voxstudio.app" style={{ color: "var(--accent)" }}>
            support@voxstudio.app
          </a>
        </p>
      </Section>
    </LegalLayout>
  );
}

/* ─── Layout dùng chung cho Terms + Privacy ─── */
export function LegalLayout({ title, onBack, children }) {
  return (
    <div style={{ height: "100%", overflowY: "auto", background: "var(--n-0)" }}>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "24px 32px 60px" }}>
        <button
          onClick={onBack}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "6px 12px", borderRadius: 7,
            background: "transparent", border: "1px solid var(--n-3)",
            color: "var(--n-9)", fontSize: 13, cursor: "pointer",
            fontFamily: "inherit", marginBottom: 24,
          }}
        >
          <ArrowLeft size={14} /> Quay lại
        </button>
        <h1 style={{
          fontSize: 28, fontWeight: 700, margin: "0 0 8px",
          color: "var(--n-10)", letterSpacing: "-0.02em",
        }}>{title}</h1>
        <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--n-9)" }}>
          {children}
        </div>
      </div>
      <style>{`
        .muted { color: var(--n-7); font-size: 12.5px; margin-bottom: 16px; }
        h2 { font-size: 17px; font-weight: 650; color: var(--n-10);
             margin: 28px 0 10px; letter-spacing: -0.01em; }
        ul { padding-left: 20px; margin: 8px 0; }
        li { margin-bottom: 6px; }
        a { text-decoration: underline; text-underline-offset: 2px; }
      `}</style>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  );
}
