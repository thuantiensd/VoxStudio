import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Trash2, Loader2, Mic2, Plus, AudioLines } from "lucide-react";
import { listVoices, deleteVoice } from "../services/api";
import { Page, PageContent } from "../components/ui/PageHeader";
import PageHeader from "../components/ui/PageHeader";
import Button from "../components/ui/Button";
import { Table, THead, TBody, Th, Tr, Td } from "../components/ui/Table";
import { useToast } from "../components/ui/Toast";
import { useT } from "../i18n/I18nContext";

export default function VoiceLibraryPage() {
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const [voices, setVoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(null);

  const load = async () => {
    try {
      const r = await listVoices();
      setVoices(r.voices || []);
    } catch {
      setVoices([]);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (v) => {
    if (!confirm(`Xoá giọng "${v.name}"?`)) return;
    setDeleting(v.id);
    try {
      await deleteVoice(v.id);
      setVoices((prev) => prev.filter((x) => x.id !== v.id));
      toast.success(`Đã xoá ${v.name}`);
    } catch (e) {
      toast.error(`Xoá thất bại: ${e?.message || e}`);
    }
    setDeleting(null);
  };

  return (
    <Page>
      <PageHeader
        title={t("shell.titleLibrary")}
        subtitle={
          voices.length > 0 ? `${voices.length} giọng đã clone` : "Chưa có giọng nào"
        }
      >
        <Button
          size="sm"
          variant="primary"
          icon={Plus}
          onClick={() => navigate("/clone")}
        >
          Clone giọng mới
        </Button>
      </PageHeader>

      <PageContent maxWidth={960}>
        {loading ? (
          <div className="flex items-center gap-2"
               style={{ color: "var(--n-8)", padding: 40 }}>
            <Loader2 size={14} className="animate-spin" /> Đang tải…
          </div>
        ) : voices.length === 0 ? (
          <EmptyState onCreate={() => navigate("/clone")} />
        ) : (
          <Table>
            <THead>
              <Th width={40} />
              <Th>Tên</Th>
              <Th>ID</Th>
              <Th width={60} align="right"> </Th>
            </THead>
            <TBody>
              {voices.map((v) => (
                <Tr key={v.id}>
                  <Td>
                    <div style={{
                      width: 28, height: 28, borderRadius: 6,
                      background: "var(--accent-soft)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <AudioLines size={14} style={{ color: "var(--accent)" }} />
                    </div>
                  </Td>
                  <Td title={v.name}>
                    <span style={{ color: "var(--n-10)", fontWeight: 500 }}>
                      {v.name}
                    </span>
                  </Td>
                  <Td title={v.id}>
                    <span className="font-mono" style={{ color: "var(--n-8)", fontSize: 11 }}>
                      {v.id}
                    </span>
                  </Td>
                  <Td align="right">
                    <IconBtn
                      title="Xoá"
                      danger
                      disabled={deleting === v.id}
                      onClick={() => handleDelete(v)}
                    >
                      {deleting === v.id
                        ? <Loader2 size={12} className="animate-spin" />
                        : <Trash2 size={12} />}
                    </IconBtn>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </PageContent>
    </Page>
  );
}

function EmptyState({ onCreate }) {
  return (
    <div style={{
      padding: 48, textAlign: "center", color: "var(--n-8)",
      border: "1px dashed var(--n-3)", borderRadius: 10,
    }}>
      <Mic2 size={32} style={{ color: "var(--n-6)", margin: "0 auto 12px" }} />
      <p style={{ fontSize: 14, color: "var(--n-10)", marginBottom: 6, fontWeight: 500 }}>
        Chưa có giọng nào
      </p>
      <p style={{ fontSize: 12, marginBottom: 16 }}>
        Clone 1 giọng từ audio mẫu để dùng trong Studio.
      </p>
      <Button variant="primary" size="md" icon={Plus} onClick={onCreate}>
        Clone giọng đầu tiên
      </Button>
    </div>
  );
}

function IconBtn({ children, onClick, title, danger, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        width: 24, height: 24,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        background: "transparent", border: "none",
        cursor: disabled ? "wait" : "pointer",
        borderRadius: 4,
        color: "var(--n-8)",
        opacity: disabled ? 0.5 : 1,
        transition: "all var(--dur-fast) var(--ease)",
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = danger ? "rgba(248,81,73,0.15)" : "var(--n-2)";
        e.currentTarget.style.color = danger ? "var(--err)" : "var(--n-10)";
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "var(--n-8)";
      }}
    >
      {children}
    </button>
  );
}
